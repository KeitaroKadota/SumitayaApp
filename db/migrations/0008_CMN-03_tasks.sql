-- 0008 CMN-03 タスク(tasks)
-- 設計書: CMN-03 01 6.1(列)・04 CH-01〜CH-07・CH-10、00_共通設計 3.1・7.5
-- 0007 の後に1回だけ実行する。
-- 種類(task_type)の値の一覧は DB では決めず、プログラムの表(src/utils/taskTypes.ts)で持つ。DB では形だけを確かめる。

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  -- 種類(例: attendance_alert)
  task_type text not null check (task_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  title text not null check (char_length(title) between 1 and 100),
  -- 内容(複数行。改行をそのまま保存する)
  body text check (char_length(body) <= 2000),
  -- 担当は「人」「区分」「機能キー」のちょうど1つ(CH-02)
  assignee_employee_id uuid references public.employees (id),
  assignee_role text check (assignee_role in ('president', 'store', 'factory', 'accounting')),
  -- 機能キーが権限表にあるかはプログラムで確かめる(CH-04)
  assignee_feature_key text check (assignee_feature_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- 期限(日本時間の日付)
  due_on date,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  -- 発行元の機能ID(例: E-02)と対象のID(uuid 以外も入れられるよう text)
  source_feature text check (source_feature ~ '^(CMN|[A-E])-\d{2}$'),
  source_id text check (char_length(source_id) <= 200),
  -- 開いてほしい画面(アプリの中のURL。CH-10)
  link_url text check (link_url ~ '^/' and link_url !~ '^//' and char_length(link_url) <= 500),
  -- 完了・取消にした時刻と人(元の機能が自動で閉じたときは completed_by が空)
  completed_at timestamptz,
  completed_by uuid references public.employees (id),
  -- 完了・取消のときのひとこと(完了のメモ)
  completion_note text check (char_length(completion_note) <= 500),
  -- すぐの通知を送った時刻
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 各機能が自動で出したときは空
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),

  constraint tasks_one_assignee_check check (num_nonnulls(assignee_employee_id, assignee_role, assignee_feature_key) = 1),
  constraint tasks_completed_at_check check ((status = 'open') = (completed_at is null))
);

-- CH-07 同じ種類・発行元・対象のIDで未完了のタスクは1件だけ(createTask の on conflict がこの索引を使う)
create unique index tasks_open_source_key on public.tasks (task_type, source_feature, source_id)
  where status = 'open' and source_id is not null;

create index tasks_assignee_employee_status_idx on public.tasks (assignee_employee_id, status);
create index tasks_assignee_role_status_idx on public.tasks (assignee_role, status);
create index tasks_assignee_feature_key_status_idx on public.tasks (assignee_feature_key, status);
create index tasks_status_due_date_idx on public.tasks (status, due_on);
create index tasks_source_idx on public.tasks (source_feature, source_id);

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;
