# 搬遷到新帳號（Render + Supabase + GitHub）

目標：把整套從 `tech@shinchitose.com` 搬到 `grace92h@gmail.com`，**過程中不斷線**。

> Render 官方文件：**無法在 workspace 之間轉移既有服務**，只能重新建立。
> 所以 Render 是「新建 → 切換 → 刪舊」，GitHub 則可以直接轉移（保留 commit 歷史與 secret）。

密鑰值全部在本機 `.env`，這個 repo 是公開的，不要把值寫進任何檔案。

---

## 順序總覽

| 階段 | 動作 | 這時候線上服務是？ |
| --- | --- | --- |
| 1 | 新 Supabase 專案 + 建表 | 舊的照常運作 |
| 2 | GitHub repo 轉移 | 舊的照常運作（只是不再自動部署） |
| 3 | 新 Render 服務上線 | 新舊並存，都活著 |
| 4 | LINE webhook 切到新網址 | **切換點**，新的接手 |
| 5 | 更新 GitHub variable | 排程改指向新服務 |
| 6 | 刪舊 Render 服務、清舊資料表 | 只剩新的 |

---

## 1. 新 Supabase 專案

1. 用 `grace92h@gmail.com` 登入 Supabase，建立新專案
   - 區域選 **ap-northeast-1（東京）**，離台灣最近
   - 免費方案上限 2 個 active 專案，新帳號有空間
2. **SQL Editor** 貼上本 repo 的 `sql/schema.sql` 執行
3. **Project Settings → API** 記下兩個值：
   - `Project URL` → 之後填 `SUPABASE_URL`
   - **secret key**（`sb_secret_…` 或 `service_role`）→ 之後填 `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ 不要用 anon / publishable key，RLS 開著會讀不到資料

> 目前舊資料表是空的（0 筆），所以沒有資料要搬。

---

## 2. GitHub repo 轉移

1. `github.com/TechShinchitose/linebot` → **Settings → General → 最下方 Transfer ownership**
2. 填 `grace92h@gmail.com` 對應的 **GitHub 使用者名稱**（不是 email），對方需在信件中接受
3. 轉移後到 **Settings → Secrets and variables → Actions** 確認：
   - Secret `TASK_KEY` 還在（repo 層級 secret 會跟著轉移）
   - Variable `SERVICE_URL` 還在（第 5 步會改它的值）
   - 若有掉，用本機 `.env` 裡的 `TASK_KEY` 重設

轉移後舊 Render 服務會失去自動部署連結，但**服務本身照常運作**，不影響第 3、4 步。

---

## 3. 新 Render 服務

1. 用 `grace92h@gmail.com` 註冊 Render，授權 GitHub，選轉移後的 `linebot` repo
2. **New → Web Service**：

   | 欄位 | 值 |
   | --- | --- |
   | Name | 取個新名字，例如 `line-signup-bot`（舊名字還被佔著） |
   | Region | Singapore |
   | Branch | main |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | Free |

3. 環境變數（`SELF_URL` 填 Render 給你的新網址）：

   | Key | 值來源 |
   | --- | --- |
   | `LINE_CHANNEL_SECRET` | 本機 `.env` |
   | `LINE_CHANNEL_ACCESS_TOKEN` | 本機 `.env` |
   | `TASK_KEY` | 本機 `.env`（必須與 GitHub secret 一致） |
   | `SUPABASE_URL` | 第 1 步的新專案 |
   | `SUPABASE_SERVICE_ROLE_KEY` | 第 1 步的新 secret key |
   | `SELF_URL` | 新服務網址，例如 `https://line-signup-bot.onrender.com` |
   | `MAX_PLAYERS` | `21` |
   | `GAME_WEEKDAY` | `2` |
   | `DEADLINE_DAYS_BEFORE` | `1` |
   | `DEADLINE_HOUR` | `12` |
   | `TIME_ZONE` | `Asia/Taipei` |
   | `PUSH_ANNOUNCE` | `true` |
   | `QUOTA_RESERVE` | `40` |
   | `AWAKE_FROM_HOUR` | `8` |
   | `AWAKE_TO_HOUR` | `23` |

4. 等 deploy 完成，確認：
   - Log 出現 **`儲存後端：Supabase`**（若出現「缺 SUPABASE_SERVICE_ROLE_KEY」代表 key 填錯）
   - Log 出現 **`自我保活已啟動`**
   - 瀏覽器打開 `新網址/health`，應回傳 `{"ok":true,"openEvent":"…"}`

---

## 4. 切換 LINE webhook（切換點）

1. LINE Developers → Messaging API → **Webhook URL** 改成 `新網址/webhook`
2. 按 **Verify**，要顯示 Success
3. 到 LINE 群組打 `幫助`，確認有回應 → 新服務正式接手

> 這一步之前群組都是舊服務在服務，之後才換手，所以不會有空窗。

---

## 5. 更新 GitHub variable

**Settings → Secrets and variables → Actions → Variables**
把 `SERVICE_URL` 改成新網址（結尾不要加 `/`）。

驗證：Actions 頁面手動跑一次 `keepalive`，要 success。

---

## 6. 清掉舊的

確認新服務跑滿一天沒問題後再做：

1. **刪除舊 Render 服務** `line-weekly-game-bot`（`tech@shinchitose.com` 帳號下）
2. **清掉舊 Supabase 殘留** —— 這兩張表建在公司專案 `omni-cart-core` 裡，搬完應該移除：
   ```sql
   drop table if exists linebot_registrations;
   drop table if exists linebot_announcements;
   ```
3. 本機 `.env` 的 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 換成新專案的值

---

## 搬完之後可以放寬保活時段

新 Render 帳號的 **750 免費 instance 小時只有這一個服務在用**，不再跟 `pharmacy-chain` 共享。
如果想讓深夜也不冷啟動，可以放寬：

| 設定 | 醒著時數／月（31 天） | 說明 |
| --- | --- | --- |
| `8` → `23`（預設） | 465 h | 最安全 |
| `7` → `24` | 527 h | 早晚各多一點 |
| 全天（`AWAKE_FROM_HOUR` = `AWAKE_TO_HOUR`） | 744 h | 只剩 6 小時緩衝，不建議 |

改 `AWAKE_FROM_HOUR` / `AWAKE_TO_HOUR` 的同時，記得同步改 `.github/workflows/keepalive.yml` 的 cron
（**GitHub cron 只吃 UTC**，台北時間要減 8 小時）。

---

## 搬完檢查清單

- [ ] `新網址/health` 回傳正確的 `openEvent` 與 `deadline`
- [ ] Render log 顯示 `儲存後端：Supabase`
- [ ] Render log 顯示 `自我保活已啟動`
- [ ] LINE 群組打 `幫助` 有回應
- [ ] 群組打 `＋測試` 有回應，且新 Supabase 的 `linebot_registrations` 出現該筆
- [ ] 上面那筆測試打 `取消` 可刪除
- [ ] GitHub `keepalive` workflow 手動執行 success
- [ ] GitHub secret `TASK_KEY`、variable `SERVICE_URL` 都是新值
- [ ] 舊 Render 服務已刪除
- [ ] `omni-cart-core` 的 `linebot_` 兩張表已 drop
