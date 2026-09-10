const { describeDeadline, formatEventDate } = require('./schedule');

// 英文全名（含空格）會比中文名長不少，所以放寬到 30。
const MAX_NAME_LENGTH = 30;
const SIGN_UP = /^(?:[+＋]|報名|我要報名|參加)\s*(.*)$/;
const CANCEL_ALL = /^(?:取消全部|全部取消|取消所有)\s*$/;
const CANCEL = /^(?:[-－]|取消|取消報名|不參加|請假|cancel)\s*(.*)$/i;
const LIST = /^(?:名單|報名名單|查名單|統計|list)\s*$/i;
const HELP = /^(?:幫助|說明|指令|help|[?？])\s*$/i;

const DIVIDER = '─────────────';

function normalize(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function formatList(entries, { eventDate, maxPlayers, gameWeekday, cycle, closed }) {
  const confirmed = entries.slice(0, maxPlayers);
  const waiting = entries.slice(maxPlayers);
  const lines = [
    `🏐 ${formatEventDate(eventDate, gameWeekday)}排球`,
    closed ? '📌 報名已截止（最終名單）' : `⏰ 截止 ${describeDeadline(cycle, gameWeekday)}`,
    `👥 正取 ${confirmed.length}/${maxPlayers}${waiting.length ? `　備取 ${waiting.length}` : ''}`,
    DIVIDER
  ];
  lines.push(...(confirmed.length ? confirmed.map((entry, index) => `${index + 1}. ${entry.name}`) : ['（尚無人報名）']));
  if (waiting.length) {
    lines.push('', '備取', ...waiting.map((entry, index) => `${index + 1}. ${entry.name}`));
  }
  return lines.join('\n');
}

function help({ maxPlayers, gameWeekday, cycle }) {
  return [
    '🏐 每週排球報名',
    '',
    `📅 本場　${formatEventDate(cycle.eventDate, gameWeekday)}`,
    `👥 名額　${maxPlayers} 人`,
    `⏰ 截止　${describeDeadline(cycle, gameWeekday)}`,
    '',
    DIVIDER,
    '怎麼報名',
    DIVIDER,
    '「＋王小明」',
    '「＋John Smith」',
    '　英文名、有空格都可以，',
    '　＋後面整串都算你的名字。',
    '',
    '「＋」只打加號',
    '　＝ 用你的 LINE 名稱報名',
    '',
    DIVIDER,
    '幫朋友報名',
    DIVIDER,
    '再打一次「＋朋友的名字」就好，',
    '同一個帳號可以報很多位。',
    '',
    DIVIDER,
    '取消',
    DIVIDER,
    '「取消」　　　只登記一位時直接取消',
    '「取消 王小明」指定取消某一位',
    '「取消全部」　取消你登記的所有人',
    '',
    DIVIDER,
    '其他指令',
    DIVIDER,
    '「名單」查看目前名單',
    '「幫助」顯示這則說明',
    '',
    '額滿會自動排備取，有人取消時依序遞補。',
    '其他訊息機器人不會回應，聊天不受影響。'
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
        const final = formatList(finalEntries, { ...context, eventDate: cycle.closedEvent, closed: true });
        message = `${final}\n\n\n下一場開放報名中\n\n${message}`;
      }
    }
    return message;
  }

  const cancelAll = CANCEL_ALL.test(input);
  const cancelMatch = cancelAll ? null : input.match(CANCEL);
  if (cancelAll || cancelMatch) {
    const own = (await store.getEntries(groupId, eventDate)).filter((entry) => entry.userId === userId);
    if (!own.length) {
      return `你尚未報名 ${formatEventDate(eventDate, gameWeekday)} 的排球。`;
    }

    if (cancelAll) {
      let entries = [];
      for (const entry of own) entries = (await store.cancel(groupId, eventDate, userId, entry.name)).entries;
      return `❎ 已取消你登記的 ${own.length} 位：${own.map((e) => e.name).join('、')}\n\n${formatList(entries, context)}`;
    }

    const wanted = normalize(cancelMatch[1]);
    // 沒指定名字時，只有一位就直接取消；有多位一定要講清楚取消誰。
    let target = own[0].name;
    if (wanted) {
      const found = own.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase());
      if (!found) {
        return `你沒有登記「${wanted}」。\n你目前登記的是：${own.map((e) => e.name).join('、')}`;
      }
      target = found.name;
    } else if (own.length > 1) {
      return [
        `你登記了 ${own.length} 位，請指定要取消誰：`,
        ...own.map((entry) => `　「取消 ${entry.name}」`),
        '',
        '要全部取消請輸入「取消全部」。'
      ].join('\n');
    }

    const result = await store.cancel(groupId, eventDate, userId, target);
    if (result.status === 'not_found') {
      return `你尚未報名 ${formatEventDate(eventDate, gameWeekday)} 的排球。`;
    }
    return `❎ 已取消 ${result.removed.name} 的報名\n\n${formatList(result.entries, context)}`;
  }

  const match = input.match(SIGN_UP);
  if (!match) return null;

  const name = normalize(match[1]) || normalize(displayName);
  if (!name) return '請在「＋」後面加上你的名字，例如：＋王小明';
  if (name.length > MAX_NAME_LENGTH) return `名字請控制在 ${MAX_NAME_LENGTH} 個字以內。`;

  const result = await store.register(groupId, eventDate, { userId, name });
  if (result.status === 'duplicate') {
    return `「${name}」已經報名過了。\n要取消請輸入「取消 ${name}」。`;
  }

  const position = result.entries.findIndex((entry) => entry.userId === userId && entry.name === name) + 1;
  const head = position > maxPlayers
    ? `🕒 ${name} 已排備取第 ${position - maxPlayers} 位\n有人取消會自動遞補。`
    : `✅ ${name} 報名成功（第 ${position} 位）`;

  // 幫別人報名時把自己名下的人列出來，方便確認有沒有漏。
  const own = result.entries.filter((entry) => entry.userId === userId);
  const mine = own.length > 1 ? `\n你目前登記 ${own.length} 位：${own.map((e) => e.name).join('、')}` : '';
  return `${head}${mine}\n\n${formatList(result.entries, context)}`;
}

module.exports = { handleText, formatList, help };
