const { openEarly, describeDeadline, describeOpen, describeManualOpen, formatEventDate } = require('./schedule');

// 英文全名（含空格）會比中文名長不少，所以放寬到 30。
const MAX_NAME_LENGTH = 30;
const DEFAULT_MIN_PLAYERS = 15;
// 指令一律用中文詞，不用符號。
// 「報名」「取消」是日常對話會出現的詞，所以帶名字時一定要有空格分隔
// （否則「報名截止了嗎」會被當成幫「截止了嗎」報名）。不合規則的訊息一律沉默。
const SIGN_UP_BARE = /^(?:報名|我要報名)$/;
const SIGN_UP_NAMED = /^(?:報名|我要報名)\s+(.+)$/;
const CANCEL_ALL = /^(?:取消全部|全部取消|取消所有)$/;
const CANCEL_BARE = /^(?:取消|取消報名)$/;
const CANCEL_NAMED = /^(?:取消|取消報名)\s+(.+)$/;
const LIST = /^(?:名單|報名名單|查名單|統計)$/;
// 主辦人指令：用「回覆」公布，不花推播額度。
const CLOSE_NOW = /^(?:截止|截止報名|結束報名)$/;
const OPEN_NOW = /^(?:開放|開放報名|開始報名)$/;
const HELP = /^(?:幫助|說明|指令|help|[?？])$/i;

// 忘記空格時（「報名王小明」）給提示，但不能去回應正常聊天（「報名截止了嗎」）。
// 判斷方式：後面那串要像名字 —— 不長、沒有標點、也不含問句或語尾助詞。
const SIGN_UP_NO_SPACE = /^(?:報名|我要報名)(\S.*)$/;
const CANCEL_NO_SPACE = /^(?:取消|取消報名)(\S.*)$/;
const PUNCTUATION = /[？?！!。，,、；;：:…~～/／\\()（）「」【】]/;
const CHAT_MARKERS = /[了嗎嘛呢吧啦喔囉耶欸哦呀啊麼誰哪幾怎沒要是不可能還在過就才也都多費]/;

function looksLikeName(text) {
  return text.length > 0 && text.length <= 20 && !PUNCTUATION.test(text) && !CHAT_MARKERS.test(text);
}

const DIVIDER = '─────────────';

function normalize(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function capacityText({ minPlayers = DEFAULT_MIN_PLAYERS, maxPlayers }) {
  return `${minPlayers} 人成團・${maxPlayers} 人額滿`;
}

function groupStatus(count, { minPlayers = DEFAULT_MIN_PLAYERS, maxPlayers }, closed) {
  if (count >= maxPlayers) return closed ? '✅ 成團（額滿）' : '🈵 已額滿，之後報名排備取';
  if (count >= minPlayers) return closed ? '✅ 成團' : `✅ 已成團，還有 ${maxPlayers - count} 個名額`;
  return closed ? `❌ 未達 ${minPlayers} 人成團（差 ${minPlayers - count} 人）` : `⏳ 還差 ${minPlayers - count} 人成團`;
}

function formatList(entries, { eventDate, minPlayers = DEFAULT_MIN_PLAYERS, maxPlayers, gameWeekday, cycle, closed }) {
  const confirmed = entries.slice(0, maxPlayers);
  const waiting = entries.slice(maxPlayers);
  const lines = [
    `🏐 ${formatEventDate(eventDate, gameWeekday)}排球`,
    closed ? '📌 報名已截止（最終名單）' : `⏰ 截止 ${describeDeadline(cycle)}`,
    `👥 正取 ${confirmed.length}/${maxPlayers}${waiting.length ? `　備取 ${waiting.length}` : ''}`,
    groupStatus(confirmed.length, { minPlayers, maxPlayers }, closed),
    DIVIDER
  ];
  lines.push(...(confirmed.length ? confirmed.map((entry, index) => `${index + 1}. ${entry.name}`) : ['（尚無人報名）']));
  if (waiting.length) {
    lines.push('', '備取', ...waiting.map((entry, index) => `${index + 1}. ${entry.name}`));
  }
  return lines.join('\n');
}

function schedulePanel({ minPlayers, maxPlayers, gameWeekday, cycle }) {
  if (!cycle.isOpen) {
    return [
      '🔒 目前不開放報名',
      '',
      `📅 下一場　${formatEventDate(cycle.eventDate, gameWeekday)}`,
      `🟢 開放　　${describeOpen(cycle)}`,
      `⏰ 截止　　${describeDeadline(cycle)}`,
      `👥 人數　　${capacityText({ minPlayers, maxPlayers })}`
    ];
  }
  return [
    `📅 本場　${formatEventDate(cycle.eventDate, gameWeekday)}`,
    `👥 人數　${capacityText({ minPlayers, maxPlayers })}`,
    `⏰ 截止　${describeDeadline(cycle)}`
  ];
}

function notOpenMessage(context) {
  return [
    '🔒 本週報名已截止，名單已確定。',
    '',
    ...schedulePanel(context).slice(2),
    '',
    '開放時間到了再報名喔！'
  ].join('\n');
}

function openAnnouncement({ minPlayers, maxPlayers, gameWeekday, cycle }) {
  return [
    '🟢 排球報名開始囉！',
    '',
    `📅 本場　${formatEventDate(cycle.eventDate, gameWeekday)}`,
    `👥 人數　${capacityText({ minPlayers, maxPlayers })}`,
    `⏰ 截止　${describeDeadline(cycle)}`,
    '',
    DIVIDER,
    '「報名 你的名字」就能報名',
    '「幫助」看完整說明'
  ].join('\n');
}

function help({ minPlayers, maxPlayers, gameWeekday, cycle }) {
  return [
    '🏐 每週排球報名',
    '',
    ...schedulePanel({ minPlayers, maxPlayers, gameWeekday, cycle }),
    '',
    DIVIDER,
    '怎麼報名',
    DIVIDER,
    '「報名 王小明」',
    '「報名 John Smith」',
    '',
    '⚠️ 報名和名字中間要空一格。',
    '　 空格後面整串都算名字，',
    '　 英文名、有空格都可以。',
    '',
    '只打「報名」兩個字',
    '　＝ 用你的 LINE 名稱報名',
    '',
    DIVIDER,
    '幫朋友報名',
    DIVIDER,
    '再打一次「報名 朋友的名字」，',
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
    DIVIDER,
    '主辦人專用',
    DIVIDER,
    '「截止」截止時間過後，公布最終名單',
    '「開放」比賽當晚 23:00 起，開放下一場',
    '',
    '額滿會自動排備取，有人取消時依序遞補。',
    '其他訊息機器人不會回應，聊天不受影響。'
  ].join('\n');
}

// 時間表是預設值；主辦人在允許的時段內手動開放過的下一場，視為已開放。
// 只認「最早可開放時刻之後」的開放標記，舊的、不合規則時段留下的標記不會生效。
async function effectiveCycle(cycle, store, groupId) {
  if (!cycle.isOpen && cycle.canOpenEarly && await store.wasAnnounced(groupId, cycle.eventDate, 'open')) {
    return openEarly(cycle);
  }
  return cycle;
}

function finalListMessage(entries, context) {
  const list = formatList(entries, { ...context, eventDate: context.cycle.closedEvent, closed: true });
  return `📋 報名截止，最終名單如下\n\n${list}\n\n\n${schedulePanel(context).join('\n')}`;
}

// 主辦人指令只能在規定時段用：截止時間過後才能公布名單，比賽當晚之後才能開放下一場。
async function adminCommand(input, { groupId, store, scheduled, base }) {
  const cycle = await effectiveCycle(scheduled, store, groupId);
  const context = { ...base, cycle };

  if (CLOSE_NOW.test(input)) {
    if (cycle.isOpen) {
      return `⏰ 還沒到截止時間，現在不能截止。\n\n${describeDeadline(cycle)} 會自動截止，\n之後再打「截止」公布最終名單。`;
    }
    return finalListMessage(await store.getEntries(groupId, cycle.closedEvent), context);
  }

  // 每一場只公告一次，避免連打「開放」把群組洗版。
  if (cycle.isOpen && await store.wasAnnounced(groupId, cycle.eventDate, 'open')) {
    const entries = await store.getEntries(groupId, cycle.eventDate);
    return [
      `🟢 ${formatEventDate(cycle.eventDate, base.gameWeekday)}這場已經開放報名了。`,
      '',
      formatList(entries, { ...context, eventDate: cycle.eventDate, closed: false })
    ].join('\n');
  }

  if (!cycle.isOpen) {
    if (!cycle.canOpenEarly) {
      return [
        '⏳ 還不能開放下一場。',
        '',
        `最早　${describeManualOpen(cycle)} 起可以打「開放」`,
        `自動　${describeOpen(cycle)} 會自動開放`
      ].join('\n');
    }
    await store.markAnnounced(groupId, cycle.eventDate, 'open');
    return openAnnouncement({ ...context, cycle: openEarly(cycle) });
  }

  await store.markAnnounced(groupId, cycle.eventDate, 'open');
  return openAnnouncement(context);
}

// 回傳 null 代表「不是指令」，機器人保持沉默，不干擾群組聊天。
async function handleText({
  text, userId, groupId, store, cycle: scheduled,
  minPlayers = DEFAULT_MIN_PLAYERS, maxPlayers, gameWeekday, displayName, isAdmin = false
}) {
  const input = normalize(text);
  if (!input) return null;
  const base = { minPlayers, maxPlayers, gameWeekday };

  if (CLOSE_NOW.test(input) || OPEN_NOW.test(input)) {
    if (!isAdmin) return '只有主辦人可以使用「截止」和「開放」。';
    return adminCommand(input, { groupId, store, scheduled, base });
  }

  const cycle = await effectiveCycle(scheduled, store, groupId);
  const eventDate = cycle.eventDate;
  const context = { ...base, eventDate, cycle, closed: false };

  if (HELP.test(input)) return help({ ...base, cycle });

  if (LIST.test(input)) {
    if (!cycle.isOpen) {
      const finalEntries = await store.getEntries(groupId, cycle.closedEvent);
      const final = formatList(finalEntries, { ...context, eventDate: cycle.closedEvent, closed: true });
      return `${final}\n\n\n${schedulePanel(context).join('\n')}`;
    }
    return formatList(await store.getEntries(groupId, eventDate), context);
  }

  // 空窗期（截止後到下一場開放前）：已結算的名單不能再動，下一場也還沒開放。
  if (!cycle.isOpen) {
    const missedSignUp = input.match(SIGN_UP_NO_SPACE);
    const missedCancelWhileClosed = input.match(CANCEL_NO_SPACE);
    const cancelIntent = CANCEL_ALL.test(input) || CANCEL_NAMED.test(input) || CANCEL_BARE.test(input)
      || Boolean(missedCancelWhileClosed && looksLikeName(missedCancelWhileClosed[1]));
    const signUpIntent = SIGN_UP_NAMED.test(input) || SIGN_UP_BARE.test(input)
      || Boolean(missedSignUp && looksLikeName(missedSignUp[1]));
    if (cancelIntent) {
      return `${notOpenMessage(context)}\n\n名單已確定無法取消，臨時不能來請直接聯絡主辦。`;
    }
    if (signUpIntent) return notOpenMessage(context);
    return null;
  }

  const missedCancel = input.match(CANCEL_NO_SPACE);
  if (missedCancel && !CANCEL_ALL.test(input) && looksLikeName(missedCancel[1])) {
    return `⚠️ 「取消」後面要空一格。\n\n請改打：\n　取消 ${missedCancel[1]}`;
  }

  const cancelAll = CANCEL_ALL.test(input);
  const cancelNamed = cancelAll ? null : input.match(CANCEL_NAMED);
  if (cancelAll || cancelNamed || CANCEL_BARE.test(input)) {
    const own = (await store.getEntries(groupId, eventDate)).filter((entry) => entry.userId === userId);
    if (!own.length) {
      return `你尚未報名 ${formatEventDate(eventDate, gameWeekday)} 的排球。`;
    }

    if (cancelAll) {
      let entries = [];
      for (const entry of own) entries = (await store.cancel(groupId, eventDate, userId, entry.name)).entries;
      return `❎ 已取消你登記的 ${own.length} 位：${own.map((e) => e.name).join('、')}\n\n${formatList(entries, context)}`;
    }

    const wanted = cancelNamed ? normalize(cancelNamed[1]) : '';
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
    // 有人取消導致掉到成團人數以下時特別提醒。
    const after = Math.min(result.entries.length, maxPlayers);
    const dropped = after === minPlayers - 1 ? `\n⚠️ 人數降到 ${after} 人，未達 ${minPlayers} 人成團` : '';
    return `❎ 已取消 ${result.removed.name} 的報名${dropped}\n\n${formatList(result.entries, context)}`;
  }

  const named = input.match(SIGN_UP_NAMED);
  if (!named && !SIGN_UP_BARE.test(input)) {
    const missed = input.match(SIGN_UP_NO_SPACE);
    if (missed && looksLikeName(missed[1])) {
      return `⚠️ 「報名」後面要空一格。\n\n請改打：\n　報名 ${missed[1]}`;
    }
    return null;
  }

  const name = named ? normalize(named[1]) : normalize(displayName);
  if (!name) return '請在「報名」後面空一格再打名字，例如：報名 王小明';
  if (name.length > MAX_NAME_LENGTH) return `名字請控制在 ${MAX_NAME_LENGTH} 個字以內。`;

  const result = await store.register(groupId, eventDate, { userId, name });
  if (result.status === 'duplicate') {
    return `「${name}」已經報名過了。\n要取消請輸入「取消 ${name}」。`;
  }

  const position = result.entries.findIndex((entry) => entry.userId === userId && entry.name === name) + 1;
  let head = position > maxPlayers
    ? `🕒 ${name} 已排備取第 ${position - maxPlayers} 位\n有人取消會自動遞補。`
    : `✅ ${name} 報名成功（第 ${position} 位）`;
  if (result.entries.length === minPlayers) head += `\n🎉 滿 ${minPlayers} 人，成團了！`;
  if (result.entries.length === maxPlayers) head += `\n🈵 ${maxPlayers} 人額滿，之後報名會排備取`;

  // 幫別人報名時把自己名下的人列出來，方便確認有沒有漏。
  const own = result.entries.filter((entry) => entry.userId === userId);
  const mine = own.length > 1 ? `\n你目前登記 ${own.length} 位：${own.map((e) => e.name).join('、')}` : '';
  return `${head}${mine}\n\n${formatList(result.entries, context)}`;
}

module.exports = { handleText, formatList, help, openAnnouncement };
