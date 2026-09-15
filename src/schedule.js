const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const WEEKDAY_LABELS = ['', '一', '二', '三', '四', '五', '六', '日'];

function localParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short'
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: WEEKDAYS[values.weekday],
    minutes: (Number(values.hour) % 24) * 60 + Number(values.minute)
  };
}

function addDays(isoDate, days) {
  const moment = new Date(`${isoDate}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

function weekdayOf(isoDate) {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function reached(local, date, hour) {
  return local.date > date || (local.date === date && local.minutes >= hour * 60);
}

// 每一場（比賽日 E）的報名期間是：開放時刻 ≤ 現在 < 截止時刻。
//   截止：E 前 deadlineDaysBefore 天的 deadlineHour 點（預設週一 12:00）
//   開放：E 之前最近一個 openWeekday 的 openHour 點（預設週三 08:00）
// 截止到下一場開放之間是空窗期，不收報名，避免有人報進已結算的名單。
function resolveCycle(now, { gameWeekday, timeZone, deadlineDaysBefore, deadlineHour, openWeekday = 3, openHour = 8 }) {
  const local = localParts(now, timeZone);
  let ahead = gameWeekday - local.weekday;
  if (ahead < 0) ahead += 7;

  // 找出「截止時刻還沒到」的最近一場
  let eventDate = addDays(local.date, ahead);
  if (reached(local, addDays(eventDate, -deadlineDaysBefore), deadlineHour)) {
    eventDate = addDays(eventDate, 7);
  }

  const deadlineDate = addDays(eventDate, -deadlineDaysBefore);
  let openDaysBefore = (gameWeekday - openWeekday + 7) % 7;
  if (openDaysBefore === 0) openDaysBefore = 7;
  const openDate = addDays(eventDate, -openDaysBefore);
  const isOpen = reached(local, openDate, openHour);

  return {
    eventDate,
    deadlineDate,
    deadlineHour,
    openDate,
    openHour,
    isOpen,
    // 空窗期時，上一場就是剛結算完的那場（名單要顯示它的最終結果）
    closedEvent: isOpen ? null : addDays(eventDate, -7)
  };
}

function formatWhen(isoDate, hour) {
  return `${isoDate}（週${WEEKDAY_LABELS[weekdayOf(isoDate)]}）${String(hour).padStart(2, '0')}:00`;
}

function describeDeadline({ deadlineDate, deadlineHour }) {
  return formatWhen(deadlineDate, deadlineHour);
}

function describeOpen({ openDate, openHour }) {
  return formatWhen(openDate, openHour);
}

function formatEventDate(isoDate, gameWeekday) {
  return `${isoDate}（週${WEEKDAY_LABELS[gameWeekday || weekdayOf(isoDate)]}）`;
}

module.exports = { resolveCycle, addDays, localParts, describeDeadline, describeOpen, formatEventDate };
