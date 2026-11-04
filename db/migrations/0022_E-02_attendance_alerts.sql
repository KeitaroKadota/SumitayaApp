-- 0022 E-02 勤怠の異常(attendance_alerts)
-- 設計書: E-02 01 6章・11.3(列)、03 の 0.3・EV-05、04 CH-01〜CH-08・CH-13、00_共通設計 3.3
-- 0021 の後に1回だけ実行する(employees を参照する)。
-- 担当は E-02。毎朝のチェック(/api/cron/daily の1番目)と、管理者が打刻・シフトを直したときに書く。
-- タスクとの結び付けは tasks の発行元(source_feature = 'E-02'・source_id = この表の id)で行い、ここにはタスクのIDを持たない。

create table public.attendance_alerts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  -- 対象の日。月の時間外(overtime_*)は給与の対象期間の最初の日
  work_date date not null,
  kind text not null check (kind in (
    'missing_clock_out', 'missing_break_end', 'missing_clock_in', 'no_punch', 'duplicate_punch', 'break_short',
    'overtime_warning', 'overtime_over', 'shift_deviation', 'work_without_shift', 'location_check'
  )),
  -- fix: 要修正 / legal: 法令 / info: 確認
  severity text not null check (severity in ('fix', 'legal', 'info')),
  -- 画面とタスクに出す文
  message text not null,
  -- 判定に使った値。「同じ内容か」の比較にも使う(CH-13)
  detail jsonb not null default '{}'::jsonb,
  -- open: 未対応 / resolved: 直って解決 / dismissed: 確認済み
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  -- 確認済みにした理由
  resolution_note text check (char_length(resolution_note) <= 200),
  -- 確認・解決した人(自動で解決したときは空)と時刻
  resolved_by uuid references public.employees (id),
  resolved_at timestamptz,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- CH-13 1人・1勤務日・1種類で1件
  constraint attendance_alerts_employee_date_kind_key unique (employee_id, work_date, kind),
  -- 確認済みは理由を残す
  check (status <> 'dismissed' or resolution_note is not null)
);

create index attendance_alerts_status_work_date_idx on public.attendance_alerts (status, work_date);

create trigger attendance_alerts_set_updated_at
before update on public.attendance_alerts
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.attendance_alerts enable row level security;
