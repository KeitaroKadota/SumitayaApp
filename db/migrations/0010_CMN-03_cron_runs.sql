-- 0010 CMN-03 定期実行の記録(cron_runs)
-- 設計書: CMN-03 01 6.3(列)・7.3・04 CH-15、00_共通設計 3.1・7.1
-- 0009 の後に1回だけ実行する。

create table public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  -- 処理の名前(例: task_digest)
  job_name text not null check (job_name ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- 対象日=実行した日(日本時間)
  run_on date not null,
  -- skipped は「今日は動かす日ではない」(休業日など)
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 結果の件数など(例: {"sent": 4, "skipped": 1})
  summary jsonb,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- CH-15 同じ日に同じ処理が2回動かないようにする
  constraint cron_runs_job_name_run_date_key unique (job_name, run_on)
);

create trigger cron_runs_set_updated_at
before update on public.cron_runs
for each row execute function public.set_updated_at();

alter table public.cron_runs enable row level security;
