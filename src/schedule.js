const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

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

// 以「截止時刻」切換場次：截止一過就換到下一場，避免有人報進已結算的名單。
function resolveCycle(now, { gameWeekday, timeZone, deadlineDaysBefore, deadlineHour }) {
  const local = localParts(now, timeZone);
  let ahead = gameWeekday - local.weekday;
  if (ahead < 0) ahead += 7;

  let eventDate = addDays(local.date, ahead);
  let deadlineDate = addDays(eventDate, -deadlineDaysBefore);
  const deadlineMinutes = deadlineHour * 60;
  const passed = local.date > deadlineDate
    || (local.date === deadlineDate && local.minutes >= deadlineMinutes);

  let closedEvent = null;
  if (passed) {
    closedEvent = eventDate;
    eventDate = addDays(eventDate, 7);
    deadlineDate = addDays(deadlineDate, 7);
  }
  return { eventDate, deadlineDate, deadlineHour, closedEvent };
}

const WEEKDAY_LABELS = ['', '一', '二', '三', '四', '五', '六', '日'];

function describeDeadline({ deadlineDate, deadlineHour }, gameWeekday) {
  const weekday = WEEKDAY_LABELS[((gameWeekday - 1 + 6) % 7) + 1];
  return `${deadlineDate}（週${weekday}）${String(deadlineHour).padStart(2, '0')}:00`;
}

function formatEventDate(isoDate, gameWeekday) {
  return `${isoDate}（週${WEEKDAY_LABELS[gameWeekday]}）`;
}

module.exports = { resolveCycle, addDays, localParts, describeDeadline, formatEventDate };
