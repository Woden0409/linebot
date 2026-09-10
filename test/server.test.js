const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SECRET = 'testsecret';
const dataFile = path.join(__dirname, '..', 'data', 'registrations.json');
fs.rmSync(dataFile, { force: true });

process.env.LINE_CHANNEL_SECRET = SECRET;
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'dummy-token';
process.env.GAME_WEEKDAY = '2';
process.env.MAX_PLAYERS = '2';
process.env.TASK_KEY = 'task-key';
process.env.QUOTA_RESERVE = '40';
delete process.env.SUPABASE_URL;

const calls = [];
const realFetch = global.fetch;
const respond = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
let usage = 0;

// 攔截所有對 LINE 的呼叫，測試不會真的送出訊息、也不會消耗額度。
global.fetch = async (url, options = {}) => {
  const target = String(url);
  calls.push({ target, body: options.body ? JSON.parse(options.body) : null });
  if (target.endsWith('/v2/bot/message/quota')) return respond({ type: 'limited', value: 200 });
  if (target.endsWith('/quota/consumption')) return respond({ totalUsage: usage });
  if (target.includes('/members/count')) return respond({ count: 20 });
  if (target.includes('/member/')) return respond({ displayName: '阿明' });
  return respond({});
};

const { server, store, closeAndAnnounce } = require('../src/server');
const { resolveCycle } = require('../src/schedule');

const cycle = resolveCycle(new Date(), { gameWeekday: 2, timeZone: 'Asia/Taipei', deadlineDaysBefore: 1, deadlineHour: 12 });
let origin;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); global.fetch = realFetch; fs.rmSync(dataFile, { force: true }); });

function replies() {
  return calls.filter((call) => call.target.endsWith('/message/reply')).map((call) => call.body.messages[0].text);
}
function pushes() {
  return calls.filter((call) => call.target.endsWith('/message/push')).map((call) => call.body.messages[0].text);
}

// server 會先回 200 再處理事件（避免 LINE 逾時重送），所以要等實際的回覆送出。
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待逾時：${label}`);
}

async function webhook(events, expectedReplies = events.length) {
  const before = replies().length;
  const payload = JSON.stringify({ destination: 'U0', events });
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64');
  const response = await realFetch(`${origin}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
    body: payload
  });
  if (expectedReplies > 0) await waitFor(() => replies().length >= before + expectedReplies, `${expectedReplies} 則回覆`);
  else await new Promise((resolve) => setTimeout(resolve, 50));
  return response.status;
}

const message = (userId, text) => ({
  type: 'message',
  replyToken: `r-${userId}-${Math.random().toString(36).slice(2)}`,
  timestamp: Date.now(),
  source: { type: 'group', groupId: 'G-test', userId },
  message: { type: 'text', text }
});

test('簽章錯誤一律拒絕', async () => {
  const response = await realFetch(`${origin}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': 'bad' },
    body: JSON.stringify({ events: [] })
  });
  assert.equal(response.status, 401);
});

test('健康檢查回報目前開放的場次與截止時間', async () => {
  const response = await realFetch(`${origin}/health`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.openEvent, cycle.eventDate);
  assert.match(body.deadline, /12:00 Asia\/Taipei/);
});

test('群組聊天不會觸發任何 LINE 呼叫（不浪費額度）', async () => {
  calls.length = 0;
  assert.equal(await webhook([message('u9', '晚上要吃什麼'), message('u9', '王小明')], 0), 200);
  assert.equal(calls.length, 0);
});

test('完整報名流程：報名、備取、取消遞補', async () => {
  calls.length = 0;
  await webhook([message('u1', '報名 甲')]);
  await webhook([message('u2', '報名 乙')]);
  await webhook([message('u3', '報名 丙')]);
  assert.match(replies()[0], /甲 報名成功（第 1 位）/);
  assert.match(replies()[2], /丙 已排備取第 1 位/);

  await webhook([message('u1', '取消')]);
  calls.length = 0;
  await webhook([message('u2', '名單')]);
  assert.match(replies()[0], /正取 2\/2/);
  assert.doesNotMatch(replies()[0], /備取 \d/);
});

test('只打「+」時用 LINE 顯示名稱報名', async () => {
  calls.length = 0;
  await webhook([message('u4', '報名')]);
  assert.match(replies()[0], /阿明 已排備取|阿明 報名成功/);
});

test('每週結算：鎖定名單、推播一次、重複呼叫不重送', async () => {
  const eventDate = cycle.eventDate;
  calls.length = 0;
  const first = await closeAndAnnounce(eventDate);
  assert.equal(first.results[0].pushed, true);
  assert.equal(first.results[0].cost, 20, '20 人群組推一則 = 扣 20 則額度');
  assert.match(pushes()[0], /最終名單/);

  calls.length = 0;
  const second = await closeAndAnnounce(eventDate);
  assert.equal(second.results[0].skipped, '已結算過');
  assert.equal(pushes().length, 0);
});

test('額度快用完時自動改為不推播，避免超額', async () => {
  usage = 175; // 剩 25 則，不足 20 + 保留 40
  await store.update((state) => { state.announced = {}; });
  calls.length = 0;
  const result = await closeAndAnnounce(cycle.eventDate);
  assert.equal(result.results[0].pushed, false);
  assert.match(result.results[0].reason, /額度不足/);
  assert.equal(pushes().length, 0);
  usage = 0;
});

test('結算端點需要 TASK_KEY', async () => {
  assert.equal((await realFetch(`${origin}/tasks/close`)).status, 401);
  assert.equal((await realFetch(`${origin}/tasks/close?key=wrong`)).status, 401);
  assert.equal((await realFetch(`${origin}/tasks/close?key=task-key&date=1990-01-01`)).status, 200);
});
