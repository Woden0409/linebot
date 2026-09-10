const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { handleText } = require('../src/bot');
const { resolveCycle } = require('../src/schedule');
const { JsonStore } = require('../src/store');

const OPTIONS = { gameWeekday: 2, timeZone: 'Asia/Taipei', deadlineDaysBefore: 1, deadlineHour: 12 };

function freshStore() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'linebot-')), 'registrations.json');
  return new JsonStore(file);
}

function context(overrides = {}) {
  return {
    store: freshStore(),
    groupId: 'g1',
    maxPlayers: 21,
    gameWeekday: 2,
    cycle: resolveCycle(new Date('2026-09-07T02:00:00Z'), OPTIONS),
    ...overrides
  };
}

test('報名週期在週一 12:00 準時切換到下一場', () => {
  // 週一 11:00 台北：本週二仍可報名
  const before = resolveCycle(new Date('2026-09-07T03:00:00Z'), OPTIONS);
  assert.equal(before.eventDate, '2026-09-08');
  assert.equal(before.deadlineDate, '2026-09-07');
  assert.equal(before.closedEvent, null);

  // 週一 12:00 台北：本週二截止，開放的變成下週二
  const atDeadline = resolveCycle(new Date('2026-09-07T04:00:00Z'), OPTIONS);
  assert.equal(atDeadline.closedEvent, '2026-09-08');
  assert.equal(atDeadline.eventDate, '2026-09-15');

  // 比賽日當天報名算下一場，不會混進已結算的名單
  const onGameDay = resolveCycle(new Date('2026-09-08T09:00:00Z'), OPTIONS);
  assert.equal(onGameDay.eventDate, '2026-09-15');
});

test('只有指令會得到回應，一般聊天完全沉默', async () => {
  const base = context();
  assert.equal(await handleText({ ...base, userId: 'u1', text: '今天天氣真好' }), null);
  assert.equal(await handleText({ ...base, userId: 'u1', text: '王小明' }), null);
  assert.match(await handleText({ ...base, userId: 'u1', text: '幫助' }), /每週排球報名/);
});

test('聊天中提到「報名」「取消」不會誤觸', async () => {
  const base = context();
  // 這些都以指令詞開頭，但沒有空格分隔，一律視為聊天
  for (const chat of ['報名截止了嗎', '報名了', '報名網址在哪', '報名要付錢嗎', '取消了嗎', '取消不了']) {
    assert.equal(await handleText({ ...base, userId: 'u1', text: chat }), null, `「${chat}」不該被當成指令`);
  }
  // 不以指令詞開頭的更不用說
  for (const chat of ['我想報名', '誰要報名', '幫我報名一下']) {
    assert.equal(await handleText({ ...base, userId: 'u1', text: chat }), null, `「${chat}」不該被當成指令`);
  }
  // 確認上面那些都沒有真的寫進名單
  assert.match(await handleText({ ...base, userId: 'u2', text: '名單' }), /（尚無人報名）/);
});

test('忘記空格時給提示，但不打擾正常聊天', async () => {
  const base = context();
  // 看起來像名字 → 給提示，並把名字回填讓對方直接照打
  const hint = await handleText({ ...base, userId: 'u1', text: '報名王小明' });
  assert.match(hint, /「報名」後面要空一格/);
  assert.match(hint, /報名 王小明/);
  assert.match(await handleText({ ...base, userId: 'u1', text: '取消王小明' }), /「取消」後面要空一格/);
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名JohnSmith' }), /報名 JohnSmith/);

  // 像在聊天 → 完全沉默，不能被提示訊息洗版
  for (const chat of [
    '報名截止了嗎', '報名了', '報名網址在哪', '報名要付錢嗎', '報名嗎', '報名時間？',
    '報名還有名額嗎', '報名可以帶人嗎', '報名怎麼用', '報名誰要去', '報名多少錢', '取消了嗎', '取消不了'
  ]) {
    assert.equal(await handleText({ ...base, userId: 'u1', text: chat }), null, `「${chat}」不該有回應`);
  }

  // 提示不會真的把人加進名單
  assert.match(await handleText({ ...base, userId: 'u2', text: '名單' }), /（尚無人報名）/);
});

test('加號不再是指令，一律沉默', async () => {
  const base = context();
  for (const old of ['+王小明', '＋王小明', '+', '＋', '-', '－']) {
    assert.equal(await handleText({ ...base, userId: 'u1', text: old }), null, `「${old}」應已停用`);
  }
});

test('報名、擋同名重複、取消', async () => {
  const base = context();
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名 王小明' }), /王小明 報名成功（第 1 位）/);
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名 王小明' }), /「王小明」已經報名過了/);
  assert.match(await handleText({ ...base, userId: 'u2', text: '報名 李小華' }), /第 2 位/);
  assert.match(await handleText({ ...base, userId: 'u1', text: '取消' }), /已取消 王小明/);
  assert.match(await handleText({ ...base, userId: 'u1', text: '取消' }), /尚未報名/);
});

test('同一個帳號可以幫朋友報多位', async () => {
  const base = context();
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名 王小明' }), /王小明 報名成功（第 1 位）/);

  const second = await handleText({ ...base, userId: 'u1', text: '報名 陳大文' });
  assert.match(second, /陳大文 報名成功（第 2 位）/);
  assert.match(second, /你目前登記 2 位：王小明、陳大文/);

  const third = await handleText({ ...base, userId: 'u1', text: '報名 John Smith' });
  assert.match(third, /你目前登記 3 位：王小明、陳大文、John Smith/);

  const list = await handleText({ ...base, userId: 'u2', text: '名單' });
  assert.match(list, /正取 3\/21/);
});

test('登記多位時，取消必須指定是誰', async () => {
  const base = context();
  await handleText({ ...base, userId: 'u1', text: '報名 王小明' });
  await handleText({ ...base, userId: 'u1', text: '報名 陳大文' });

  const ask = await handleText({ ...base, userId: 'u1', text: '取消' });
  assert.match(ask, /你登記了 2 位，請指定要取消誰/);
  assert.match(ask, /「取消 王小明」/);
  assert.match(ask, /「取消 陳大文」/);

  assert.match(await handleText({ ...base, userId: 'u1', text: '取消 陳大文' }), /已取消 陳大文/);
  // 剩一位時「取消」不必再指定
  assert.match(await handleText({ ...base, userId: 'u1', text: '取消' }), /已取消 王小明/);
});

test('取消全部，以及取消不存在的名字', async () => {
  const base = context();
  await handleText({ ...base, userId: 'u1', text: '報名 王小明' });
  await handleText({ ...base, userId: 'u1', text: '報名 陳大文' });

  const wrong = await handleText({ ...base, userId: 'u1', text: '取消 不存在的人' });
  assert.match(wrong, /你沒有登記「不存在的人」/);
  assert.match(wrong, /王小明、陳大文/);

  const all = await handleText({ ...base, userId: 'u1', text: '取消全部' });
  assert.match(all, /已取消你登記的 2 位：王小明、陳大文/);
  assert.match(all, /（尚無人報名）/);
});

test('取消全部只清掉自己的，不會動到別人', async () => {
  const base = context();
  await handleText({ ...base, userId: 'u1', text: '報名 王小明' });
  await handleText({ ...base, userId: 'u1', text: '報名 陳大文' });
  await handleText({ ...base, userId: 'u2', text: '報名 李小美' });
  await handleText({ ...base, userId: 'u2', text: '報名 張三' });
  await handleText({ ...base, userId: 'u3', text: '報名 趙六' });

  const all = await handleText({ ...base, userId: 'u1', text: '取消全部' });
  assert.match(all, /已取消你登記的 2 位：王小明、陳大文/);

  const list = await handleText({ ...base, userId: 'u9', text: '名單' });
  assert.match(list, /正取 3\/21/);
  assert.match(list, /李小美/);
  assert.match(list, /張三/);
  assert.match(list, /趙六/);
  assert.doesNotMatch(list, /王小明/);
  assert.doesNotMatch(list, /陳大文/);
});

test('兩個人登記同一個名字時，各自只能取消自己那筆', async () => {
  const base = context();
  // u1 和 u2 各自帶了一位都叫「王小明」的朋友
  await handleText({ ...base, userId: 'u1', text: '報名 王小明' });
  await handleText({ ...base, userId: 'u1', text: '報名 陳大文' });
  await handleText({ ...base, userId: 'u2', text: '報名 王小明' });

  let list = await handleText({ ...base, userId: 'u9', text: '名單' });
  assert.match(list, /正取 3\/21/, '同名不同人算兩個名額');

  // u1 指定取消「王小明」，不能影響 u2 的那筆
  assert.match(await handleText({ ...base, userId: 'u1', text: '取消 王小明' }), /已取消 王小明/);
  list = await handleText({ ...base, userId: 'u9', text: '名單' });
  assert.match(list, /正取 2\/21/);
  assert.match(list, /王小明/, 'u2 登記的王小明還在');

  // u1 取消全部，只會帶走自己剩下的陳大文
  assert.match(await handleText({ ...base, userId: 'u1', text: '取消全部' }), /已取消你登記的 1 位：陳大文/);
  list = await handleText({ ...base, userId: 'u9', text: '名單' });
  assert.match(list, /正取 1\/21/);
  assert.match(list, /1\. 王小明/, '最後只剩 u2 的王小明');
});

test('只能取消自己登記的人', async () => {
  const base = context();
  await handleText({ ...base, userId: 'u1', text: '報名 王小明' });
  assert.match(await handleText({ ...base, userId: 'u2', text: '取消 王小明' }), /尚未報名/);
  const list = await handleText({ ...base, userId: 'u1', text: '名單' });
  assert.match(list, /1\. 王小明/);
});

test('指令後面整串都算名字，英文名與空格不會被截掉', async () => {
  const base = context();
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名 John Smith' }), /John Smith 報名成功/);
  assert.match(await handleText({ ...base, userId: 'u2', text: '報名 Mary Jane Watson' }), /Mary Jane Watson 報名成功/);
  assert.match(await handleText({ ...base, userId: 'u3', text: '報名 David Chen Jr.' }), /David Chen Jr\. 報名成功/);

  const list = await handleText({ ...base, userId: 'u1', text: '名單' });
  assert.match(list, /1\. John Smith/);
  assert.match(list, /2\. Mary Jane Watson/);
  assert.match(list, /3\. David Chen Jr\./);
});

test('沒寫名字時用 LINE 顯示名稱', async () => {
  const base = context();
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名', displayName: '阿明' }), /阿明 報名成功/);
});

test('額滿自動列備取，有人取消時自動遞補', async () => {
  const base = context({ maxPlayers: 2 });
  await handleText({ ...base, userId: 'u1', text: '報名 甲' });
  await handleText({ ...base, userId: 'u2', text: '報名 乙' });
  assert.match(await handleText({ ...base, userId: 'u3', text: '報名 丙' }), /已排備取第 1 位/);

  await handleText({ ...base, userId: 'u1', text: '取消' });
  const list = await handleText({ ...base, userId: 'u3', text: '名單' });
  assert.match(list, /正取 2\/2/);
  assert.doesNotMatch(list, /備取/);
});

test('名單同時顯示已截止的最終名單與下一場', async () => {
  const store = freshStore();
  const closedCycle = resolveCycle(new Date('2026-09-07T04:00:00Z'), OPTIONS);
  await store.register('g1', closedCycle.closedEvent, { userId: 'u1', name: '王小明' });
  const message = await handleText({ ...context({ store, cycle: closedCycle }), userId: 'u2', text: '名單' });
  assert.match(message, /報名已截止（最終名單）/);
  assert.match(message, /下一場開放報名中/);
});
