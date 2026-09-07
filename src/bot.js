const { describeDeadline, formatEventDate } = require('./schedule');

const MAX_NAME_LENGTH = 20;
const SIGN_UP = /^(?:[+＋]|報名|我要報名|參加)\s*(.*)$/;
const CANCEL = /^(?:[-－]|取消|取消報名|不參加|請假|cancel)\s*$/i;
const LIST = /^(?:名單|報名名單|查名單|統計|list)\s*$/i;
const HELP = /^(?:幫助|說明|指令|help|[?？])\s*$/i;

function normalize(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function formatList(entries, { eventDate, maxPlayers, gameWeekday, cycle, closed }) {
  const confirmed = entries.slice(0, maxPlayers);
  const waiting = entries.slice(maxPlayers);
  const lines = [
    `🏀 ${formatEventDate(eventDate, gameWeekday)} 球賽`,
    closed ? '📌 報名已截止（最終名單）' : `⏰ 截止：${describeDeadline(cycle, gameWeekday)}`,
    `正取 ${confirmed.length}/${maxPlayers} 人${waiting.length ? `，備取 ${waiting.length} 人` : ''}`,
    ''
  ];
  lines.push(...(confirmed.length ? confirmed.map((entry, index) => `${index + 1}. ${entry.name}`) : ['（尚無人報名）']));
  if (waiting.length) {
    lines.push('', '— 備取 —', ...waiting.map((entry, index) => `${index + 1}. ${entry.name}`));
  }
  return lines.join('\n');
}

function help({ maxPlayers, gameWeekday, cycle }) {
  return [
    '🏀 每週球賽報名',
    `本場：${formatEventDate(cycle.eventDate, gameWeekday)}，名額 ${maxPlayers} 人`,
    `截止：${describeDeadline(cycle, gameWeekday)}（額滿自動列備取）`,
    '',
    '＋王小明　→ 報名（也可打「報名 王小明」）',
    '＋　　　　→ 用你的 LINE 名稱報名',
    '取消　　　→ 取消自己的報名',
    '名單　　　→ 查看目前名單',
    '幫助　　　→ 顯示這則說明',
    '',
    '※ 其他訊息機器人不會回應，聊天不受影響。'
  ].join('\n');
}

// 回傳 null 代表「不是指令」，機器人保持沉默，不干擾群組聊天。
async function handleText({ text, userId, groupId, store, cycle, maxPlayers, gameWeekday, displayName }) {
  const input = normalize(text);
  const eventDate = cycle.eventDate;
  const context = { eventDate, maxPlayers, gameWeekday, cycle, closed: false };

  if (HELP.test(input)) return help({ maxPlayers, gameWeekday, cycle });

  if (LIST.test(input)) {
    const entries = await store.getEntries(groupId, eventDate);
    let message = formatList(entries, context);
    if (cycle.closedEvent) {
      const finalEntries = await store.getEntries(groupId, cycle.closedEvent);
      if (finalEntries.length) {
        message = `${formatList(finalEntries, { ...context, eventDate: cycle.closedEvent, closed: true })}\n\n———\n下一場開放報名中：\n${message}`;
      }
    }
    return message;
  }

  if (CANCEL.test(input)) {
    const result = await store.cancel(groupId, eventDate, userId);
    if (result.status === 'not_found') {
      return `你尚未報名 ${formatEventDate(eventDate, gameWeekday)} 的球賽。`;
    }
    return `已取消 ${result.removed.name} 的報名。\n\n${formatList(result.entries, context)}`;
  }

  const match = input.match(SIGN_UP);
  if (!match) return null;

  const name = normalize(match[1]) || normalize(displayName);
  if (!name) return '請在「＋」後面加上你的姓名，例如：＋王小明';
  if (name.length > MAX_NAME_LENGTH) return `姓名請控制在 ${MAX_NAME_LENGTH} 個字以內。`;

  const result = await store.register(groupId, eventDate, { userId, name });
  if (result.status === 'duplicate') {
    const current = result.entries.find((entry) => entry.userId === userId);
    return `你已經報名了，登記姓名是「${current.name}」。要換人請先輸入「取消」。`;
  }

  const position = result.entries.findIndex((entry) => entry.userId === userId) + 1;
  const head = position > maxPlayers
    ? `🕒 ${name} 已列備取第 ${position - maxPlayers} 位（有人取消會自動遞補）。`
    : `✅ ${name} 報名成功，第 ${position} 位。`;
  return `${head}\n\n${formatList(result.entries, context)}`;
}

module.exports = { handleText, formatList, help };
