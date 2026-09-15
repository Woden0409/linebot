# LINE 每週排球報名機器人

群組成員用「報名 姓名」報名每週二的排球，週一 12:00（台灣時間）自動截止並結算名單。
以 LINE 使用者 ID 辨識，可以幫朋友代報，但只能取消自己登記的人。

## 群組指令

| 輸入 | 作用 |
| --- | --- |
| `報名 王小明` | 以「王小明」報名 |
| `報名 John Smith` | 空格後面整串都算名字，英文名、空格都可以（上限 30 字） |
| `報名`（只有兩個字） | 用你的 LINE 顯示名稱報名 |
| 再打一次 `報名 朋友名字` | **幫朋友報名**，同一個帳號可登記多位 |
| `取消` | 只登記一位時直接取消；登記多位時會問要取消誰 |
| `取消 王小明` | 指定取消自己登記的某一位 |
| `取消全部` | 取消自己登記的所有人 |
| `名單` | 查看目前名單；截止後會同時顯示最終名單與下一場 |
| `幫助` | 顯示操作說明 |

指令一律用中文詞，不用 `+` `-` 之類的符號。

**帶名字時一定要有空格分隔**（`報名 王小明`，不是 `報名王小明`）。
因為「報名」「取消」是日常對話會出現的詞，沒有這條規則的話，群組裡有人講
「報名截止了嗎」就會被當成幫「截止了嗎」報名。

忘記空格時（`報名王小明`）會回一則提示並把名字回填，方便直接照打：

```
⚠️ 「報名」後面要空一格。

請改打：
　報名 王小明
```

提示只在「後面那串看起來像名字」時才出現 —— 判斷方式是不長、沒有標點、
也不含問句或語尾助詞（`了 嗎 呢 吧 哪 誰 怎 多 …`）。所以
「報名截止了嗎」「報名多少錢」這類聊天仍然完全沉默。

這是啟發式判斷，不可能百分之百準；但誤判的後果只是多一則無關的提示，
不會把人誤加進名單。

同一個 LINE 帳號可以報多個**不同**名字（代朋友報名），但同一人報**同一個**名字會被擋掉。
只能取消自己登記的人；兩個人各自登記同名的朋友時，彼此不會互相影響。

**其他訊息機器人一律不回應**，群組正常聊天不會被干擾，也不會誤報名。

## 時間規則

| 時間（台灣） | 發生什麼 | 設定 |
| --- | --- | --- |
| 時間（台灣） | 發生什麼 | 設定 |
| --- | --- | --- |
| **週三 08:00** | 自動開放下一場報名（不發通知） | `OPEN_WEEKDAY=3`、`OPEN_HOUR=8` |
| **週一 12:00** | 自動截止報名（不發通知） | `DEADLINE_DAYS_BEFORE=1`、`DEADLINE_HOUR=12` |
| 週一 12:00 ～ 週三 08:00 | 空窗期：不收報名、也不能取消（名單已確定） | — |
| 週二 | 比賽日 | `GAME_WEEKDAY=2` |

時間到了會**自動**開放與截止，但**不會主動發訊息**（群組 54 人，推播一次就扣 54 則，免費額度撐不住）。
要公布時由主辦人在群組打指令，機器人用「回覆」發出，不花任何額度：

| 主辦人輸入 | 作用 |
| --- | --- |
| `截止` | 還開著就**立刻截止**；已過截止時間就只是公布。回覆最終名單＋下一場開放時間 |
| `開放` | 還沒開放就**立刻開放**；已開放就只是公布。回覆開放報名通知 |

- 只有 `ADMIN_USER_IDS` 裡的 LINE 帳號能用，其他人打會回「只有主辦人可以使用」
- 手動截止或開放只影響打指令的那個群組
- 空窗期打「報名」「取消」會回覆下一場的開放與截止時間；打「名單」看得到剛結算的最終名單
- 名額 21 人（`MAX_PLAYERS`），額滿自動排備取，有人取消時依報名順序自動遞補

> 自動推播的程式仍保留（`/tasks/open`、`/tasks/close`），目前以 `PUSH_ANNOUNCE=false` 關閉，
> cron-job.org 的 `linebot-close`、`linebot-open` 也已暫停。之後升級付費方案想恢復自動推播，
> 把 `PUSH_ANNOUNCE` 改回 `true` 並重新啟用那兩個排程即可。

## 免費額度怎麼算（重要）

LINE 免費版每月 **200 則**，而且 **push 是按收訊人數計費**：往 20 人群組推一則 = 扣 20 則。

| 行為 | 計費 |
| --- | --- |
| 群組有人輸入指令、機器人回覆（reply） | **不計費、無上限** |
| 你自己測試訊息 | 同上，**不計費** |
| 主辦人打「截止」「開放」，機器人回覆公布 | **不計費** |
| 自動推播（目前關閉） | 群組人數 × 1 則／次 |

**目前每月用量是 0 則。** 所有訊息都是回覆。

推播到群組是按群組人數計費：54 人的群組推一次就扣 54 則，免費 200 則一個月只夠推 3 次，
連每週推一次都不夠，所以改成主辦人手動公布。

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
| 服務網址 | https://line-signup-bot-fa1z.onrender.com |
| Render | 帳號 `grace92h@gmail.com`，service `line-signup-bot`（free / Singapore） |
| Supabase | 專案 `cwkwdgthunobiqaohyym`（ap-northeast-1），資料表 `linebot_registrations`、`linebot_announcements` |
| GitHub | `Woden0409/linebot`（public） |
| Webhook URL | https://line-signup-bot-fa1z.onrender.com/webhook |
| 保活時段 | **全天 24 小時**（31 天的月份約 744 instance 小時，上限 750 由整個 workspace 共用） |
| 保活 | cron-job.org job `linebot-keepalive`（每 10 分鐘）＋服務自我 ping ＋ GitHub Actions 每小時備援 |
| 截止／開放公布 | 主辦人在群組打「截止」「開放」（自動推播已關閉，排程暫停中） |

> 服務網址在 workflow 裡是讀 repo variable **`SERVICE_URL`**（Settings → Secrets and variables → Actions → Variables），
> 換部署位置只要改那一個值。搬遷步驟見 [`MIGRATION.md`](MIGRATION.md)。

## 部署（Render 免費版 + Supabase 免費版）

Render 免費版磁碟不持久、15 分鐘沒流量會休眠，所以資料存 Supabase，並用外部排程保活。

### 1. Supabase

1. 建立免費專案，到 **SQL Editor** 貼上 `sql/schema.sql` 執行。
   既有專案要升級時，改跑 `sql/` 底下編號的遷移檔（例如 `002_allow_multiple_names_per_user.sql`）。
2. 到 **Project Settings → API** 取得 `Project URL` 與 `service_role` key。

### 2. Render

1. 用這個 repo 建立 **Web Service**（Free 方案），或直接用 `render.yaml`。
2. 環境變數依 `.env.example` 填入，其中 `TASK_KEY` 自己產一組亂數：
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

### 3. 休眠與保活（三層）

Render 免費版**閒置 15 分鐘就休眠，喚醒約 1 分鐘**，而 LINE 的 **reply token 只有 1 分鐘有效** ——
睡著時收到的報名很可能回不了話。所以要保活。

目前設定為**全天 24 小時保活**（`AWAKE_FROM_HOUR` 與 `AWAKE_TO_HOUR` 都設 `0` 代表全天）。

⚠️ **額度很緊，要留意**：750 免費 instance 小時是整個 Render workspace 共用的。

| 月份天數 | 24 小時保活用掉 | 剩餘緩衝 |
| --- | --- | --- |
| 28 天 | 672 h | 78 h |
| 30 天 | 720 h | 30 h |
| **31 天** | **744 h** | **只剩 6 h** |

同 workspace 的 `baoge-backend` 也是免費 web service（目前用量 0）。只要它開始被使用，
31 天的月份就可能超過 750 → **兩個免費服務一起被停用到下個月**。

要留安全邊際的話，把 `AWAKE_FROM_HOUR=5`、`AWAKE_TO_HOUR=4`（等於只有台北 04:00–05:00 休眠）
就能降到 713 h，多出 37 小時緩衝，而那一小時幾乎不會有人報名。

三層保險同時運作：

| 層級 | 機制 | 設定 | 說明 |
| --- | --- | --- | --- |
| 主要 | **cron-job.org** | 全天每 10 分鐘（一天 144 次），時區 Asia/Taipei | 準時觸發是它的本業。能**喚醒**已休眠的服務 |
| 第二層 | 服務自我 ping `src/keepalive.js` | 每 10 分鐘，依 `AWAKE_FROM_HOUR`～`AWAKE_TO_HOUR` | 服務活著時自己撐住；睡著時無法自救 |
| 備援 | GitHub Actions `keepalive.yml` | `0 * * * *`（UTC）= 每小時 | 前兩層都失效時的保險 |

> ⚠️ **GitHub Actions 不能當主要保活手段**。原本設每 10 分鐘（一天應 90 次），
> 實測一天只跑 4 次、間隔 4–6 小時、還會跑到設定的時段範圍外 —— 公開 repo 的高頻 cron
> 會被大幅延遲或丟棄，撐不住 15 分鐘的休眠門檻。曾因此讓 LINE 的 webhook 連通測試直接 `REQUEST_TIMEOUT`。

### 資料庫保活

Supabase 免費專案**連續 7 天沒有任何存取就會被暫停**，會讓機器人整個掛掉。

`/health` 每小時會順手對資料庫做一次最輕量的查詢，因為 `/health` 本來就被保活排程每 10 分鐘打一次，
等於資料庫續命跟服務保活綁在同一條線上，不必額外開服務或把金鑰交給第三方。

狀態直接看 `/health` 的回應：

```json
{ "ok": true, "openEvent": "...", "deadline": "...", "db": { "lastOkAt": "2026-09-10T05:12:00.000Z" } }
```

`db.lastError` 有值就代表資料庫連線出問題。

每週結算主要由 cron-job.org 在週一 12:00 觸發；`weekly-close.yml`（cron `5 4 * * 1` UTC）僅為備援，
`TASK_KEY` 存在 repo secret。端點是冪等的，所以 GitHub 排程延遲不影響正確性。

手動觸發（例如臨時要重新結算）：

```bash
gh workflow run weekly-close.yml --repo Woden0409/linebot -f date=2026-09-08
gh workflow run keepalive.yml --repo Woden0409/linebot
```

> ⚠️ GitHub 會在 repo **連續 60 天沒有 commit** 時自動停用排程 workflow（會先寄信通知）。
> 收到通知時到 Actions 頁面按 enable，或隨便推一個 commit 即可。

要改保活時段，調整 Render 的 `AWAKE_FROM_HOUR` / `AWAKE_TO_HOUR`，
並同步改 `.github/workflows/keepalive.yml` 的 cron（**GitHub cron 只吃 UTC**，台北時間要減 8 小時）。

### 4. LINE Developers

1. Messaging API 頁面開啟 **Allow bot to join group chats**。
2. 關閉 LINE Official Account Manager 的自動回應，避免一則訊息被回兩次。
3. Webhook URL 設為 `https://line-signup-bot-fa1z.onrender.com/webhook`，Verify 後啟用 **Use webhook**。
4. 把官方帳號邀請進 LINE 群組。

## 手動操作

```bash
# 手動結算指定日期的場次（會推播，會扣額度）
curl "https://line-signup-bot-fa1z.onrender.com/tasks/close?key=你的TASK_KEY&date=2026-09-08"

# 看服務狀態與目前開放的場次
curl https://line-signup-bot-fa1z.onrender.com/health
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
