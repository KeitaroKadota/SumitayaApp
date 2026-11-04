-- 0021 E-02 シフト(shifts)
-- 設計書: E-02 01 9章・11.1(列)、04 CH-11、00_共通設計 3.3
-- 0020 の後に1回だけ実行する(employees・work_locations を参照する)。
-- 担当は E-02。1人1日1件。登録しない日は「予定なし」。シフトは予定なので、削除は行ごと消す(打刻と違い記録を残さない)。

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  work_date date not null,
  -- 出勤・有給休暇(1日)・有給休暇(半日。働く部分の時刻を持つ)・特別休暇・欠勤(【仮】00_仮決め一覧 E-02-仮-16)
  kind text not null check (kind in ('work', 'paid_leave', 'paid_leave_half', 'special_leave', 'absence')),
  -- work・paid_leave_half のとき必須。終了は開始より後(夜12時をまたぐシフトは初回は扱わない。E-02-仮-17)
  start_time time,
  end_time time,
  -- 予定の休憩(分)
  break_minutes integer not null default 0 check (break_minutes >= 0),
  -- 勤務場所
  location_id uuid references public.work_locations (id),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  constraint shifts_employee_work_date_key unique (employee_id, work_date),
  -- 出勤・半休は開始・終了が要る。休みの区分は時刻と休憩を持たない
  check (
    (kind in ('work', 'paid_leave_half') and start_time is not null and end_time is not null and end_time > start_time)
    or (kind in ('paid_leave', 'special_leave', 'absence') and start_time is null and end_time is null and break_minutes = 0)
  )
);

create index shifts_work_date_idx on public.shifts (work_date);

create trigger shifts_set_updated_at
before update on public.shifts
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.shifts enable row level security;
