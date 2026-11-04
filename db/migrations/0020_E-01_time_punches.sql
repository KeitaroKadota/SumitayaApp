-- 0020 E-01 打刻(time_punches)
-- 設計書: E-01 01 7.1(列)、03 EV-03、04 CH-01・CH-05・CH-11、00_共通設計 3.3
-- 0019 の後に1回だけ実行する(employees・work_locations を参照する)。
-- 担当は E-01。E-02 が修正で「取り消し(voided_*)＋追加(source = manual)」を書く。
-- 打刻した行は書き換えず、削除もしない(労働時間の記録の保存。労働基準法 第109条・第143条)。

create table public.time_punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  -- 出勤・休憩開始・休憩終了・退勤(CH-01)
  kind text not null check (kind in ('clock_in', 'break_start', 'break_end', 'clock_out')),
  -- 打刻の時刻(サーバーの時刻。CH-11。修正で足した行は管理者が入れた時刻)
  punched_at timestamptz not null,
  -- 勤務日(出勤の打刻の日。日本時間。夜12時をまたいだ休憩・退勤も出勤と同じ日。E-01 01 4.2)
  work_date date not null,
  -- app: 本人がスマホで打刻 / manual: 管理者が E-02 で追加
  source text not null check (source in ('app', 'manual')),
  -- いちばん近い打刻場所
  location_id uuid references public.work_locations (id),
  -- in_range: 範囲内 / out_of_range: 範囲外 / unavailable: 位置が取れなかった / not_checked: 場所が未登録、または修正で足した行
  location_status text not null check (location_status in ('in_range', 'out_of_range', 'unavailable', 'not_checked')),
  -- 位置(CH-05 の範囲の外の値は保存しない)
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  -- 位置の誤差(m。ブラウザが返す値)
  accuracy_m integer check (accuracy_m >= 0),
  -- いちばん近い打刻場所までの距離(m)
  distance_m integer check (distance_m >= 0),
  -- メモ(修正の理由など)
  note text check (char_length(note) <= 500),
  -- 取り消し(E-02)。空なら有効
  voided_at timestamptz,
  voided_by uuid references public.employees (id),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 本人(app)または管理者(manual)
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  -- 緯度・経度は2つそろって入る
  check ((latitude is null) = (longitude is null)),
  -- 取り消したときは理由を残す(E-02 の「取り消し＋追加」。理由は必須)
  check (voided_at is null or void_reason is not null)
);

create index time_punches_employee_work_date_idx on public.time_punches (employee_id, work_date);
create index time_punches_employee_punched_at_idx on public.time_punches (employee_id, punched_at);

create trigger time_punches_set_updated_at
before update on public.time_punches
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.time_punches enable row level security;
