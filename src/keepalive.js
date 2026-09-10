const { localParts } = require('./schedule');

// Render 免費版閒置 15 分鐘就休眠，喚醒約要 1 分鐘，而 LINE 的 reply token 只有 1 分鐘有效，
// 睡著時收到的報名等於回不了話。但 750 免費小時是整個 workspace 共用的，
// 24 小時不休眠一個月就要 744 小時會把額度吃光，所以只在有人會報名的時段保持喚醒。
function isAwakeWindow(now, { timeZone, fromHour, toHour }) {
  const { minutes } = localParts(now, timeZone);
  const hour = minutes / 60;
  if (fromHour === toHour) return true;              // 設成相同代表全天
  if (fromHour < toHour) return hour >= fromHour && hour < toHour;
  return hour >= fromHour || hour < toHour;           // 跨午夜，例如 22 → 02
}

function startKeepAlive({ selfUrl, timeZone, fromHour, toHour, intervalMinutes = 10, fetchImpl = fetch, log = console }) {
  if (!selfUrl) {
    log.warn('未設定 SELF_URL，跳過自我保活（服務閒置 15 分鐘後會休眠）');
    return null;
  }
  const target = `${selfUrl.replace(/\/$/, '')}/health`;
  const tick = async () => {
    if (!isAwakeWindow(new Date(), { timeZone, fromHour, toHour })) return;
    await fetchImpl(target).catch((error) => log.warn('保活請求失敗', error.message));
  };
  const timer = setInterval(tick, intervalMinutes * 60 * 1000);
  timer.unref?.();
  const window = fromHour === toHour ? '全天' : `${fromHour}:00–${toHour}:00 ${timeZone}`;
  log.log(`自我保活已啟動：${target}，每 ${intervalMinutes} 分鐘，時段 ${window}`);
  return { timer, tick };
}

module.exports = { isAwakeWindow, startKeepAlive };
