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

test('截止後到週三 08:00 是空窗期，週三 08:00 準時開放下一場', () => {
  // 週一 12:00 截止 → 空窗期開始
  const closed = resolveCycle(new Date('2026-09-14T04:00:00Z'), OPTIONS);
  assert.equal(closed.isOpen, false);
  assert.equal(closed.closedEvent, '2026-09-15', '剛結算的是 9/15 那場');
  assert.equal(closed.eventDate, '2026-09-22', '下一場是 9/22');
  assert.equal(closed.openDate, '2026-09-16', '下一場 9/16（週三）開放');

  // 比賽日當天、週三 07:59 都還在空窗期
  assert.equal(resolveCycle(new Date('2026-09-15T10:00:00Z'), OPTIONS).isOpen, false);
  assert.equal(resolveCycle(new Date('2026-09-15T23:59:00Z'), OPTIONS).isOpen, false);

  // 週三 08:00 準時開放
  const opened = resolveCycle(new Date('2026-09-16T00:00:00Z'), OPTIONS);
  assert.equal(opened.isOpen, true);
  assert.equal(opened.eventDate, '2026-09-22');
  assert.equal(opened.closedEvent, null);

  // 週一 11:59 仍開放，12:00 關閉
  assert.equal(resolveCycle(new Date('2026-09-21T03:59:00Z'), OPTIONS).isOpen, true);
  assert.equal(resolveCycle(new Date('2026-09-21T04:00:00Z'), OPTIONS).isOpen, false);
});

test('空窗期不能報名也不能取消，聊天照樣沉默', async () => {
  const store = freshStore();
  const closed = resolveCycle(new Date('2026-09-14T06:00:00Z'), OPTIONS); // 週一 14:00
  await store.register('g1', '2026-09-15', { userId: 'u1', name: '王小明' });
  const base = context({ store, cycle: closed });

  for (const text of ['報名 陳大文', '報名', '報名陳大文']) {
    const reply = await handleText({ ...base, userId: 'u2', text });
    assert.match(reply, /本週報名已截止/, `「${text}」應提示尚未開放`);
    assert.match(reply, /開放　　2026-09-16（週三）08:00/);
  }
  for (const text of ['取消', '取消 王小明', '取消全部']) {
    assert.match(await handleText({ ...base, userId: 'u1', text }), /名單已確定無法取消/);
  }
  assert.equal(await handleText({ ...base, userId: 'u1', text: '報名截止了嗎' }), null);

  // 名單沒有被動到，下一場也沒有被寫入
  assert.equal((await store.getEntries('g1', '2026-09-15')).length, 1);
  assert.equal((await store.getEntries('g1', '2026-09-22')).length, 0);
});

test('截止時間還沒到，主辦人不能打「截止」', async () => {
  const store = freshStore();
  const open = resolveCycle(new Date('2026-09-19T02:00:00Z'), OPTIONS); // 週六 10:00，9/22 那場開放中
  const base = { store, groupId: 'g1', maxPlayers: 21, gameWeekday: 2, cycle: open };
  await handleText({ ...base, userId: 'u1', text: '報名 王小明' });

  const reply = await handleText({ ...base, userId: 'admin', isAdmin: true, text: '截止' });
  assert.match(reply, /還沒到截止時間，現在不能截止/);
  assert.match(reply, /2026-09-21（週一）12:00 會自動截止/);

  // 報名照常開著
  assert.match(await handleText({ ...base, userId: 'u2', text: '報名 陳大文' }), /報名成功（第 2 位）/);
});

test('截止時間過後，主辦人打「截止」公布最終名單', async () => {
  const store = freshStore();
  await store.register('g1', '2026-09-22', { userId: 'u1', name: '王小明' });
  await store.register('g1', '2026-09-22', { userId: 'u2', name: '陳大文' });
  const closed = resolveCycle(new Date('2026-09-21T04:00:00Z'), OPTIONS); // 週一 12:00
  const base = { store, groupId: 'g1', maxPlayers: 21, gameWeekday: 2, cycle: closed };

  const reply = await handleText({ ...base, userId: 'admin', isAdmin: true, text: '截止' });
  assert.match(reply, /報名截止，最終名單如下/);
  assert.match(reply, /2026-09-22（週二）排球/);
  assert.match(reply, /1\. 王小明/);
  assert.match(reply, /❌ 未達 15 人成團（差 13 人）/);
  assert.match(reply, /開放　　2026-09-23（週三）08:00/, '附上下一場開放時間');

  // 可以重複公布
  assert.match(await handleText({ ...base, userId: 'admin', isAdmin: true, text: '截止' }), /1\. 王小明/);
});

test('週二 23:00 前不能打「開放」，23:00 起可以', async () => {
  const store = freshStore();
  const common = { store, groupId: 'g1', maxPlayers: 21, gameWeekday: 2 };

  // 週一 15:17（跟實際誤觸的時間一樣）→ 不行
  const monday = { ...common, cycle: resolveCycle(new Date('2026-09-21T07:17:00Z'), OPTIONS) };
  const denied = await handleText({ ...monday, userId: 'admin', isAdmin: true, text: '開放' });
  assert.match(denied, /還不能開放下一場/);
  assert.match(denied, /最早　2026-09-22（週二）23:00 起可以打「開放」/);
  assert.match(denied, /自動　2026-09-23（週三）08:00 會自動開放/);
  assert.match(await handleText({ ...monday, userId: 'u1', text: '報名 王小明' }), /本週報名已截止/);

  // 週二 22:59 → 還是不行
  const before = { ...common, cycle: resolveCycle(new Date('2026-09-22T14:59:00Z'), OPTIONS) };
  assert.match(await handleText({ ...before, userId: 'admin', isAdmin: true, text: '開放' }), /還不能開放下一場/);

  // 週二 23:00 → 可以，開的是 9/29 那場
  const night = { ...common, cycle: resolveCycle(new Date('2026-09-22T15:00:00Z'), OPTIONS) };
  const opened = await handleText({ ...night, userId: 'admin', isAdmin: true, text: '開放' });
  assert.match(opened, /排球報名開始囉/);
  assert.match(opened, /2026-09-29（週二）/);
  assert.match(opened, /15 人成團・21 人額滿/);
  assert.match(await handleText({ ...night, userId: 'u1', text: '報名 王小明' }), /王小明 報名成功（第 1 位）/);
  assert.equal((await store.getEntries('g1', '2026-09-29')).length, 1);
});

test('每一場只公告一次開放，連打「開放」不會洗版', async () => {
  const store = freshStore();
  const common = { store, groupId: 'g1', maxPlayers: 21, gameWeekday: 2 };

  // 自動開放之後（週三 10:00）打第一次 → 完整公告
  const wed = { ...common, cycle: resolveCycle(new Date('2026-09-23T02:00:00Z'), OPTIONS) };
  const first = await handleText({ ...wed, userId: 'admin', isAdmin: true, text: '開放' });
  assert.match(first, /排球報名開始囉/);
  assert.match(first, /2026-09-29（週二）/);

  // 第二次、第三次 → 只回「已經開放」和目前名單，不再重發公告
  for (const round of ['第二次', '第三次']) {
    const again = await handleText({ ...wed, userId: 'admin', isAdmin: true, text: '開放' });
    assert.doesNotMatch(again, /排球報名開始囉/, `${round}不該再發公告`);
    assert.match(again, /2026-09-29（週二）這場已經開放報名了/);
    assert.match(again, /正取 0\/21/);
  }

  // 下一場（10/6）是新的一場，可以再公告一次
  const nextWeek = { ...common, cycle: resolveCycle(new Date('2026-09-30T02:00:00Z'), OPTIONS) };
  assert.match(await handleText({ ...nextWeek, userId: 'admin', isAdmin: true, text: '開放' }), /排球報名開始囉/);
});

test('提前開放後再打「開放」也不會重發公告', async () => {
  const store = freshStore();
  const night = { store, groupId: 'g1', maxPlayers: 21, gameWeekday: 2, cycle: resolveCycle(new Date('2026-09-22T15:00:00Z'), OPTIONS) };
  assert.match(await handleText({ ...night, userId: 'admin', isAdmin: true, text: '開放' }), /排球報名開始囉/);
  const again = await handleText({ ...night, userId: 'admin', isAdmin: true, text: '開放' });
  assert.doesNotMatch(again, /排球報名開始囉/);
  assert.match(again, /這場已經開放報名了/);

  // 報名仍然正常
  assert.match(await handleText({ ...night, userId: 'u1', text: '報名 王小明' }), /報名成功/);
});

test('不合規則時段留下的舊開放標記不會生效', async () => {
  const store = freshStore();
  // 模擬週一下午（新規則之前）留下的開放標記
  await store.markAnnounced('g1', '2026-09-29', 'open');
  const monday = resolveCycle(new Date('2026-09-21T08:00:00Z'), OPTIONS); // 週一 16:00
  const base = { store, groupId: 'g1', maxPlayers: 21, gameWeekday: 2, cycle: monday };
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名 王小明' }), /本週報名已截止/);
  assert.equal((await store.getEntries('g1', '2026-09-29')).length, 0);
});

test('一般成員不能截止或開放', async () => {
  const store = freshStore();
  const open = resolveCycle(new Date('2026-09-19T02:00:00Z'), OPTIONS);
  const base = { store, groupId: 'g1', maxPlayers: 21, gameWeekday: 2, cycle: open };

  assert.match(await handleText({ ...base, userId: 'u1', text: '截止' }), /只有主辦人可以使用/);
  assert.match(await handleText({ ...base, userId: 'u1', text: '開放' }), /只有主辦人可以使用/);
  assert.match(await handleText({ ...base, userId: 'u1', text: '報名 王小明' }), /報名成功/);
});

test('手動開放只影響那一個群組', async () => {
  const store = freshStore();
  const night = resolveCycle(new Date('2026-09-22T15:30:00Z'), OPTIONS); // 週二 23:30
  const common = { store, maxPlayers: 21, gameWeekday: 2, cycle: night };
  await handleText({ ...common, groupId: 'g1', userId: 'admin', isAdmin: true, text: '開放' });
  assert.match(await handleText({ ...common, groupId: 'g1', userId: 'u1', text: '報名 A' }), /報名成功/);
  assert.match(await handleText({ ...common, groupId: 'g2', userId: 'u1', text: '報名 A' }), /本週報名已截止/);
});

test('15 人成團、21 人額滿的狀態顯示', async () => {
  const base = context();
  for (let i = 1; i <= 13; i += 1) await handleText({ ...base, userId: `u${i}`, text: `報名 球員${i}` });
  assert.match(await handleText({ ...base, userId: 'u99', text: '名單' }), /⏳ 還差 2 人成團/);

  await handleText({ ...base, userId: 'u14', text: '報名 球員14' });
  const fifteenth = await handleText({ ...base, userId: 'u15', text: '報名 球員15' });
  assert.match(fifteenth, /🎉 滿 15 人，成團了！/);
  assert.match(fifteenth, /✅ 已成團，還有 6 個名額/);

  for (let i = 16; i <= 20; i += 1) await handleText({ ...base, userId: `u${i}`, text: `報名 球員${i}` });
  const full = await handleText({ ...base, userId: 'u21', text: '報名 球員21' });
  assert.match(full, /🈵 21 人額滿，之後報名會排備取/);
  assert.match(full, /正取 21\/21/);

  assert.match(await handleText({ ...base, userId: 'u22', text: '報名 球員22' }), /已排備取第 1 位/);

  // 有人取消，備取遞補後仍是 21 人
  await handleText({ ...base, userId: 'u1', text: '取消' });
  assert.match(await handleText({ ...base, userId: 'u99', text: '名單' }), /正取 21\/21/);
});

test('取消後掉到成團人數以下會提醒', async () => {
  const base = context();
  for (let i = 1; i <= 15; i += 1) await handleText({ ...base, userId: `u${i}`, text: `報名 球員${i}` });
  const reply = await handleText({ ...base, userId: 'u3', text: '取消' });
  assert.match(reply, /⚠️ 人數降到 14 人，未達 15 人成團/);
  assert.match(reply, /⏳ 還差 1 人成團/);
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
  assert.doesNotMatch(list, /備取 \d/, '遞補後不該還有備取人數');
});

test('名單同時顯示已截止的最終名單與下一場', async () => {
  const store = freshStore();
  const closedCycle = resolveCycle(new Date('2026-09-07T04:00:00Z'), OPTIONS);
  await store.register('g1', closedCycle.closedEvent, { userId: 'u1', name: '王小明' });
  const message = await handleText({ ...context({ store, cycle: closedCycle }), userId: 'u2', text: '名單' });
  assert.match(message, /報名已截止（最終名單）/);
  assert.match(message, /目前不開放報名/);
  assert.match(message, /開放　　2026-09-09（週三）08:00/);
});
