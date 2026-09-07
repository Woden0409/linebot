const http = require('node:http');
const crypto = require('node:crypto');
const { createStore } = require('./store');
const { resolveCycle, formatEventDate } = require('./schedule');
const { handleText, formatList, help } = require('./bot');
const { startKeepAlive } = require('./keepalive');

const config = {
  port: Number(process.env.PORT || 3000),
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  maxPlayers: Number(process.env.MAX_PLAYERS || 21),
  gameWeekday: Number(process.env.GAME_WEEKDAY || 2),
  timeZone: process.env.TIME_ZONE || 'Asia/Taipei',
  deadlineDaysBefore: Number(process.env.DEADLINE_DAYS_BEFORE || 1),
  deadlineHour: Number(process.env.DEADLINE_HOUR || 12),
  taskKey: process.env.TASK_KEY,
  pushAnnounce: process.env.PUSH_ANNOUNCE !== 'false',
  quotaReserve: Number(process.env.QUOTA_RESERVE || 40),
  selfUrl: process.env.SELF_URL,
  awakeFromHour: Number(process.env.AWAKE_FROM_HOUR || 8),
  awakeToHour: Number(process.env.AWAKE_TO_HOUR || 23)
};

const store = createStore(process.env);
const cycleOptions = {
  gameWeekday: config.gameWeekday,
  timeZone: config.timeZone,
  deadlineDaysBefore: config.deadlineDaysBefore,
  deadlineHour: config.deadlineHour
};

async function lineApi(pathname, options = {}) {
  const response = await fetch(`https://api.line.me${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json', ...options.headers }
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`LINE ${pathname} ${response.status}: ${body}`);
    error.status = response.status;
    throw error;
  }
  return body ? JSON.parse(body) : null;
}

const VERIFY_TOKEN = '00000000000000000000000000000000';

// reply 不計入每月免費額度，所以群組互動一律走這裡。
async function reply(replyToken, text) {
  if (!replyToken || replyToken === VERIFY_TOKEN) return;
  await lineApi('/v2/bot/message/reply', {
    method: 'POST',
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 4900) }] })
  });
}

// push 按「群組人數」計費，只在每週結算時用一次，而且先確認額度夠。
async function pushWithQuotaGuard(groupId, text) {
  const [quota, consumption, members] = await Promise.all([
    lineApi('/v2/bot/message/quota'),
    lineApi('/v2/bot/message/quota/consumption'),
    lineApi(`/v2/bot/group/${groupId}/members/count`).catch(() => ({ count: config.maxPlayers }))
  ]);
  const cost = members.count || 1;
  if (quota.type === 'limited') {
    const remaining = quota.value - consumption.totalUsage;
    if (remaining - cost < config.quotaReserve) {
      return { pushed: false, reason: `額度不足：剩 ${remaining} 則，本次需 ${cost} 則，保留下限 ${config.quotaReserve} 則`, cost, remaining };
    }
  }
  await lineApi('/v2/bot/message/push', {
    method: 'POST',
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: text.slice(0, 4900) }] })
  });
  return { pushed: true, cost, remaining: quota.type === 'limited' ? quota.value - consumption.totalUsage - cost : null };
}

async function memberDisplayName(source) {
  const scope = source.groupId ? `group/${source.groupId}` : `room/${source.roomId}`;
  const profile = await lineApi(`/v2/bot/${scope}/member/${source.userId}`).catch(() => null);
  return profile?.displayName || '';
}

const BARE_SIGN_UP = /^(?:[+＋]|報名|參加)\s*$/;

async function processEvent(event) {
  const cycle = resolveCycle(new Date(event.timestamp || Date.now()), cycleOptions);
  const base = { maxPlayers: config.maxPlayers, gameWeekday: config.gameWeekday, cycle };

  if (event.type === 'join' || event.type === 'memberJoined') {
    return reply(event.replyToken, help(base));
  }
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const groupId = event.source.groupId || event.source.roomId;
  const userId = event.source.userId;
  if (!groupId || !userId) return;

  const bare = BARE_SIGN_UP.test(String(event.message.text).trim());
  const message = await handleText({
    ...base,
    text: event.message.text,
    userId,
    groupId,
    store,
    displayName: bare ? await memberDisplayName(event.source) : ''
  });
  if (message) await reply(event.replyToken, message);
}

// 每週一 12:05（台北）由外部排程呼叫：鎖定名單並推播最終結果。
async function closeAndAnnounce(overrideDate) {
  const cycle = resolveCycle(new Date(), cycleOptions);
  const eventDate = overrideDate || cycle.closedEvent;
  if (!eventDate) return { ok: true, skipped: '目前不在截止時段，未做任何事', now: new Date().toISOString() };

  const groups = await store.listGroups(eventDate);
  const results = [];
  for (const groupId of groups) {
    if (await store.wasAnnounced(groupId, eventDate)) {
      results.push({ groupId, skipped: '已結算過' });
      continue;
    }
    const entries = await store.getEntries(groupId, eventDate);
    const body = formatList(entries, {
      eventDate, maxPlayers: config.maxPlayers, gameWeekday: config.gameWeekday, cycle, closed: true
    });
    const text = `📋 報名截止，最終名單如下\n\n${body}`;

    let outcome = { pushed: false, reason: 'PUSH_ANNOUNCE=false' };
    if (config.pushAnnounce) {
      outcome = await pushWithQuotaGuard(groupId, text).catch((error) => ({ pushed: false, reason: error.message }));
    }
    if (outcome.pushed) await store.markAnnounced(groupId, eventDate);
    results.push({ groupId, total: entries.length, confirmed: Math.min(entries.length, config.maxPlayers), ...outcome, text });
  }
  return { ok: true, eventDate, groups: results.length, results };
}

function verifySignature(body, signature) {
  if (!config.channelSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.channelSecret).update(body).digest('base64');
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/health') {
    const cycle = resolveCycle(new Date(), cycleOptions);
    return send(response, 200, {
      ok: true,
      openEvent: cycle.eventDate,
      deadline: `${cycle.deadlineDate} ${String(cycle.deadlineHour).padStart(2, '0')}:00 ${config.timeZone}`
    });
  }

  if (request.method === 'GET' && url.pathname === '/tasks/close') {
    if (!config.taskKey || url.searchParams.get('key') !== config.taskKey) return send(response, 401, { ok: false, error: 'unauthorized' });
    return closeAndAnnounce(url.searchParams.get('date'))
      .then((result) => send(response, 200, result))
      .catch((error) => { console.error(error); send(response, 500, { ok: false, error: error.message }); });
  }

  if (request.method !== 'POST' || url.pathname !== '/webhook') return send(response, 404, { ok: false, error: 'not found' });

  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', async () => {
    const body = Buffer.concat(chunks);
    if (!verifySignature(body, request.headers['x-line-signature'])) return send(response, 401, { ok: false, error: 'invalid signature' });
    // 先回 200，避免 LINE 逾時重送造成重複處理；後續錯誤只記在 log。
    send(response, 200, { ok: true });
    try {
      const payload = JSON.parse(body.toString('utf8'));
      for (const event of payload.events || []) {
        await processEvent(event).catch((error) => console.error('event failed', error));
      }
    } catch (error) {
      console.error(error);
    }
  });
});

if (require.main === module) {
  if (!config.channelSecret || !config.accessToken) console.warn('尚未設定 LINE_CHANNEL_SECRET 或 LINE_CHANNEL_ACCESS_TOKEN');
  if (!config.taskKey) console.warn('尚未設定 TASK_KEY，每週結算端點 /tasks/close 將無法使用');
  server.listen(config.port, () => {
    console.log(`LINE bot listening on ${config.port}（活動日=週${config.gameWeekday}，截止=前 ${config.deadlineDaysBefore} 天 ${config.deadlineHour}:00 ${config.timeZone}）`);
    startKeepAlive({
      selfUrl: config.selfUrl,
      timeZone: config.timeZone,
      fromHour: config.awakeFromHour,
      toHour: config.awakeToHour
    });
  });
}

module.exports = { server, store, verifySignature, closeAndAnnounce, config };
