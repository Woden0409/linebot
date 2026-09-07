# LINE 每週球賽報名機器人

群組成員用「＋姓名」報名每週二的球賽，週一 12:00（台灣時間）自動截止並結算名單。
以 LINE 使用者 ID 辨識，同一人不能重複報名，也只能取消自己的名額。

## 群組指令

| 輸入 | 作用 |
| --- | --- |
| `＋王小明` 或 `報名 王小明` | 以「王小明」報名 |
| `＋`（後面不加字） | 用你的 LINE 顯示名稱報名 |
| `取消` | 取消自己的報名（後面的備取自動遞補） |
| `名單` | 查看目前名單；截止後會同時顯示最終名單與下一場 |
| `幫助` | 顯示操作說明 |

**其他訊息機器人一律不回應**，群組正常聊天不會被干擾，也不會誤報名。

## 時間規則

- 比賽日：每週二（`GAME_WEEKDAY=2`）
- 報名截止：比賽前一天 12:00 台灣時間 → **週一 12:00**（`DEADLINE_DAYS_BEFORE=1`、`DEADLINE_HOUR=12`）
- 週一 12:00 一到就切換場次：之後報名的人自動算下一週，不會混進已結算的名單
- 名額 21 人（`MAX_PLAYERS`），額滿自動列備取，有人取消時依報名順序自動遞補

## 免費額度怎麼算（重要）

LINE 免費版每月 **200 則**，而且 **push 是按收訊人數計費**：往 20 人群組推一則 = 扣 20 則。

| 行為 | 計費 |
| --- | --- |
| 群組有人輸入指令、機器人回覆（reply） | **不計費、無上限** |
| 你自己測試訊息 | 同上，**不計費** |
| 週一 12:00 自動推播最終名單（push） | 20 人群組 = 20 則／次，一個月約 80～100 則 |

所以日常互動全部走 reply，**只有每週結算那一次**用 push，一個月約用掉一半額度，剩約 100 則備用。

程式內建兩道保護：

1. 推播前先查 `/v2/bot/message/quota` 與 consumption，若「剩餘額度 − 本次成本」低於 `QUOTA_RESERVE`（預設 40）就**自動不推播**，名單照樣存在資料庫，群組打「名單」免費看得到。
2. `PUSH_ANNOUNCE=false` 可完全關閉推播，變成零額度消耗模式。

查目前用量：

```bash
curl -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" https://api.line.me/v2/bot/message/quota
curl -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" https://api.line.me/v2/bot/message/quota/consumption
```

## 目前部署

| 項目 | 位置 |
| --- | --- |
| 服務網址 | https://line-weekly-game-bot.onrender.com |
| Render | workspace `My Workspace`，service `line-weekly-game-bot`（free / Singapore） |
| Supabase | 專案 `omni-cart-core`（ap-northeast-1），資料表 `linebot_registrations`、`linebot_announcements` |
| Webhook URL | https://line-weekly-game-bot.onrender.com/webhook |
| 保活時段 | 台北 08:00–23:00（約 465 instance 小時／月，上限 750 由整個 workspace 共用） |
| 排程 | GitHub Actions：`keepalive.yml`（每 10 分鐘）、`weekly-close.yml`（週一 12:05 台北） |

## 部署（Render 免費版 + Supabase 免費版）

Render 免費版磁碟不持久、15 分鐘沒流量會休眠，所以資料存 Supabase，並用外部排程保活。

### 1. Supabase

1. 建立免費專案，到 **SQL Editor** 貼上 `sql/schema.sql` 執行。
2. 到 **Project Settings → API** 取得 `Project URL` 與 `service_role` key。

### 2. Render

1. 用這個 repo 建立 **Web Service**（Free 方案），或直接用 `render.yaml`。
2. 環境變數依 `.env.example` 填入，其中 `TASK_KEY` 自己產一組亂數：
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

### 3. 休眠與排程（GitHub Actions，免費）

Render 免費版**閒置 15 分鐘就休眠，喚醒約 1 分鐘**，而 LINE 的 **reply token 只有 1 分鐘有效** ——
睡著時收到的報名很可能回不了話。所以要保活。

但 **750 免費 instance 小時是整個 Render workspace 共用的**（本帳號的 `pharmacy-chain` 也在用），
24 小時不休眠一個月要 744 小時，會把額度吃光 → **所有免費 web service 一起被停用到下個月**。

因此採「時段式保活」：只在台北 **08:00–23:00** 保持喚醒，約 **465 小時／月**，留約 285 小時給其他服務。
深夜報名只會遇到一次約 1 分鐘的冷啟動延遲。

兩道保險同時運作：

| 機制 | 設定 | 說明 |
| --- | --- | --- |
| GitHub Actions `keepalive.yml` | `*/10 0-14 * * *`（UTC）= 台北 08:00–22:50 每 10 分鐘 | 能**喚醒**已休眠的服務。公開 repo 的 Actions 分鐘數免費無上限 |
| 服務自我 ping `src/keepalive.js` | 每 10 分鐘，`AWAKE_FROM_HOUR`～`AWAKE_TO_HOUR` | 補上 GitHub 排程延遲的空隙；服務睡著時無法自救，所以需要上面那個 |

每週結算由 `weekly-close.yml` 負責，cron `5 4 * * 1`（UTC）= **每週一 12:05 台北時間**，
`TASK_KEY` 存在 repo secret。端點是冪等的，所以 GitHub 排程延遲不影響正確性。

手動觸發（例如臨時要重新結算）：

```bash
gh workflow run weekly-close.yml --repo TechShinchitose/linebot -f date=2026-09-08
gh workflow run keepalive.yml --repo TechShinchitose/linebot
```

> ⚠️ GitHub 會在 repo **連續 60 天沒有 commit** 時自動停用排程 workflow（會先寄信通知）。
> 收到通知時到 Actions 頁面按 enable，或隨便推一個 commit 即可。

要改保活時段，調整 Render 的 `AWAKE_FROM_HOUR` / `AWAKE_TO_HOUR`，
並同步改 `.github/workflows/keepalive.yml` 的 cron（**GitHub cron 只吃 UTC**，台北時間要減 8 小時）。

### 4. LINE Developers

1. Messaging API 頁面開啟 **Allow bot to join group chats**。
2. 關閉 LINE Official Account Manager 的自動回應，避免一則訊息被回兩次。
3. Webhook URL 設為 `https://line-weekly-game-bot.onrender.com/webhook`，Verify 後啟用 **Use webhook**。
4. 把官方帳號邀請進 LINE 群組。

## 手動操作

```bash
# 手動結算指定日期的場次（會推播，會扣額度）
curl "https://line-weekly-game-bot.onrender.com/tasks/close?key=你的TASK_KEY&date=2026-09-08"

# 看服務狀態與目前開放的場次
curl https://line-weekly-game-bot.onrender.com/health
```

## 本機開發

需要 Node.js 18 以上，專案零外部相依套件。

```bash
npm start   # 未設定 SUPABASE_URL 時會改用 data/registrations.json
npm test
```

## 結構

| 檔案 | 內容 |
| --- | --- |
| `src/schedule.js` | 時區與週期計算（截止時刻切換場次） |
| `src/bot.js` | 指令解析與訊息排版 |
| `src/store.js` | `JsonStore`（本機）與 `SupabaseStore`（正式），介面相同 |
| `src/server.js` | webhook、`/health`、`/tasks/close`、額度保護 |
| `src/keepalive.js` | 時段式自我保活 |
| `.github/workflows/` | 保活與每週結算排程 |
