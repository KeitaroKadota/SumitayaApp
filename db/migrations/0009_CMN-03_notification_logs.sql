-- 0009 CMN-03 通知の記録(notification_logs)
-- 設計書: CMN-03 01 6.2(列)・04 CH-11・CH-16・CH-17、00_共通設計 3.1
-- 0008 の後に1回だけ実行する。
-- 送れた・失敗・送らなかったをすべて残す。トークンなどの秘密は入れない。
-- 【仮】記録は1年残す。古い記録を消す処理は初回は作らない(00_仮決め一覧 CMN03-仮-10)

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  -- 宛先の従業員
  employee_id uuid references public.employees (id),
  -- 送ったときの宛先(あとから結び付けが変わっても分かるように写しを残す)
  line_user_id text,
  channel text not null default 'line' check (channel in ('line')),
  kind text not null check (kind in ('task_created', 'task_digest', 'test', 'linked', 'other')),
  -- すぐの通知のときの対象のタスク
  task_id uuid references public.tasks (id),
  -- kind = other のとき、送った機能ID
  source_feature text,
  -- 送った本文(LINE の上限の5,000文字まで。CH-16)
  message text not null check (char_length(message) <= 5000),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  -- 送らなかった理由(未連携・退職・送信オフ・1日の上限。CH-11)
  skip_reason text check (skip_reason in ('not_linked', 'inactive', 'disabled', 'daily_limit')),
  -- 失敗したときの LINE の返事
  error text check (char_length(error) <= 500),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_logs_created_at_idx on public.notification_logs (created_at);
create index notification_logs_employee_created_at_idx on public.notification_logs (employee_id, created_at);
-- タスクの詳細(管理。G04)で、そのタスクの通知の記録を読むため
create index notification_logs_task_idx on public.notification_logs (task_id);

create trigger notification_logs_set_updated_at
before update on public.notification_logs
for each row execute function public.set_updated_at();

alter table public.notification_logs enable row level security;
