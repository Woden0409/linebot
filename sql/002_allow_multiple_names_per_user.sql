-- 允許同一個 LINE 帳號報多個名字（代朋友報名）。
-- 原本主鍵是 (group_id, event_date, user_id)，同一人只能佔一個名額；
-- 把 name 併入主鍵後，同一人可報多位，但同一人報同一個名字仍會被擋掉。
--
-- 這是非破壞性變更，既有資料會保留。在 Supabase 主控台 → SQL Editor 執行一次即可。

alter table linebot_registrations
  drop constraint linebot_registrations_pkey;

alter table linebot_registrations
  add constraint linebot_registrations_pkey
  primary key (group_id, event_date, user_id, name);
