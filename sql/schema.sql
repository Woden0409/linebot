-- Supabase 資料表（在 Supabase 主控台 → SQL Editor 貼上執行一次即可）

create table if not exists linebot_registrations (
  group_id   text        not null,
  event_date date        not null,
  user_id    text        not null,
  name       text        not null,
  created_at timestamptz not null default now(),
  -- name 併入主鍵：同一個 LINE 帳號可以幫朋友報多個名字，
  -- 但同一人報同一個名字仍會被擋掉。
  primary key (group_id, event_date, user_id, name)
);

-- 正取／備取只看 created_at 先後，因此有人取消時後面自動遞補，不需要另外記狀態。
create index if not exists linebot_registrations_event_idx on linebot_registrations (event_date, group_id, created_at);

create table if not exists linebot_announcements (
  group_id     text        not null,
  event_date   date        not null,
  announced_at timestamptz not null default now(),
  primary key (group_id, event_date)
);

-- 只有伺服器（service_role key）會存取，不開放 anon。
alter table linebot_registrations enable row level security;
alter table linebot_announcements enable row level security;
