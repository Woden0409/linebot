const test = require('node:test');
const assert = require('node:assert/strict');
const { isAwakeWindow, startKeepAlive } = require('../src/keepalive');

const WINDOW = { timeZone: 'Asia/Taipei', fromHour: 8, toHour: 23 };
const at = (utc) => new Date(utc);

test('保活時段以台北時間判斷', () => {
  assert.equal(isAwakeWindow(at('2026-09-07T00:00:00Z'), WINDOW), true, '台北 08:00 → 開始保活');
  assert.equal(isAwakeWindow(at('2026-09-07T07:00:00Z'), WINDOW), true, '台北 15:00');
  assert.equal(isAwakeWindow(at('2026-09-07T14:59:00Z'), WINDOW), true, '台北 22:59');
  assert.equal(isAwakeWindow(at('2026-09-07T15:00:00Z'), WINDOW), false, '台北 23:00 → 停止保活，讓它休眠');
  assert.equal(isAwakeWindow(at('2026-09-06T20:00:00Z'), WINDOW), false, '台北 04:00 → 深夜不保活');
});

test('跨午夜的時段設定也正確', () => {
  const overnight = { timeZone: 'Asia/Taipei', fromHour: 22, toHour: 2 };
  assert.equal(isAwakeWindow(at('2026-09-07T14:30:00Z'), overnight), true, '台北 22:30');
  assert.equal(isAwakeWindow(at('2026-09-07T17:00:00Z'), overnight), true, '台北 01:00');
  assert.equal(isAwakeWindow(at('2026-09-07T02:00:00Z'), overnight), false, '台北 10:00');
});

test('fromHour 等於 toHour 代表全天保活（目前的正式設定）', () => {
  const always = { timeZone: 'Asia/Taipei', fromHour: 0, toHour: 0 };
  for (const utc of ['2026-09-06T20:00:00Z', '2026-09-07T00:00:00Z', '2026-09-07T15:00:00Z', '2026-09-07T23:59:00Z']) {
    assert.equal(isAwakeWindow(at(utc), always), true, `${utc} 應該保活`);
  }
});

test('沒設 SELF_URL 就不啟動保活', () => {
  const warnings = [];
  const result = startKeepAlive({ selfUrl: '', log: { warn: (m) => warnings.push(m), log: () => {} } });
  assert.equal(result, null);
  assert.match(warnings[0], /未設定 SELF_URL/);
});

test('保活只在時段內打 /health', async () => {
  const hits = [];
  const keepAlive = startKeepAlive({
    selfUrl: 'https://example.onrender.com/',
    timeZone: 'Asia/Taipei',
    fromHour: 8,
    toHour: 23,
    fetchImpl: async (url) => { hits.push(url); return new Response('{}'); },
    log: { warn: () => {}, log: () => {} }
  });

  const realDate = Date;
  const freeze = (utc) => { global.Date = class extends realDate { constructor(...args) { super(...(args.length ? args : [utc])); } }; };

  freeze('2026-09-07T07:00:00Z'); // 台北 15:00
  await keepAlive.tick();
  freeze('2026-09-06T20:00:00Z'); // 台北 04:00
  await keepAlive.tick();
  global.Date = realDate;
  clearInterval(keepAlive.timer);

  assert.deepEqual(hits, ['https://example.onrender.com/health'], '只有時段內那次會發出請求');
});
