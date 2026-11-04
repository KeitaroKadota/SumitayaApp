-- 0023 E-03 給与の締めと出力の記録(payroll_exports)
-- 設計書: E-03 01 8.1(列)・5.2・5.3、03 の EV-04〜EV-06、04 CH-06・CH-07、00_共通設計 3.3
-- 0022 の後に1回だけ実行する(employees を参照する)。
-- 担当は E-03。対象期間ごとに1行。行が無い期間は「締め前」。締めたときに行を作り、解除しても行と snapshot は消さない
-- (勤怠の記録・賃金台帳の保存の決まりのため。労働基準法 第109条)。

create table public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  -- 期間の呼び方(終わりの日の月)
  year_month text not null check (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_start date not null,
  period_end date not null,
  -- closed: 締め済み / reopened: 締めを解除した
  status text not null check (status in ('closed', 'reopened')),
  -- 最後に締めた人・時刻と、締めたときのメモ(確認した異常の件数など)
  closed_by uuid not null references public.employees (id),
  closed_at timestamptz not null,
  close_note text check (char_length(close_note) <= 500),
  -- 最後に解除した人・時刻・理由
  reopened_by uuid references public.employees (id),
  reopened_at timestamptz,
  reopen_reason text check (char_length(reopen_reason) between 1 and 200),
  -- 締めた回数(解除して締め直すと増える)
  close_count integer not null default 1 check (close_count >= 1),
  -- 締めたときの集計(人ごとの値・使った定数・締めたときの未対応の異常の一覧)。CSVはここから作る
  snapshot jsonb not null,
  -- snapshot の SHA-256(CH-06。出力のときに一致を確かめる)
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  -- CSVを出力した回数と、最後に出力した人・時刻
  export_count integer not null default 0 check (export_count >= 0),
  last_exported_by uuid references public.employees (id),
  last_exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  constraint payroll_exports_period_start_key unique (period_start),
  check (period_end >= period_start),
  -- 解除した状態は、解除した人・時刻・理由を残す
  check (status <> 'reopened' or (reopened_by is not null and reopened_at is not null and reopen_reason is not null))
);

-- 日付から期間を探す(isPayrollClosed)
create index payroll_exports_period_idx on public.payroll_exports (period_start, period_end);

create trigger payroll_exports_set_updated_at
before update on public.payroll_exports
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.payroll_exports enable row level security;
