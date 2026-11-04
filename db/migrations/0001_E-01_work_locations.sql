-- 0001 E-01 打刻の場所(work_locations)と、共通のトリガー関数 set_updated_at()
-- 設計書: E-01 01 7.2、00_共通設計 1章・7.5(employees より先に作る)
-- Supabase の SQL Editor で、0001 → 0002 の順に1回だけ実行する。

-- 共通: 行を更新したときに updated_at を今の時刻にする(すべてのテーブルに付ける)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 打刻の場所(店舗・工場)。画面からは書かず、SQL で入れる
create table public.work_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('store', 'factory')),
  -- 空のあいだは位置の判定をしない(not_checked)
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  -- 【仮】範囲は 200m(E-01 01 5章)
  radius_m integer not null default 200 check (radius_m > 0),
  -- 【仮】週の法定労働時間 2400分(40時間)。E-02 の時間外の計算に使う
  weekly_legal_minutes integer not null default 2400 check (weekly_legal_minutes > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- employees を参照する制約は、employees を作る 0002 で付ける
  created_by uuid,
  updated_by uuid
);

create trigger work_locations_set_updated_at
before update on public.work_locations
for each row execute function public.set_updated_at();

-- 行単位のアクセス制限(RLS)を有効にする。ポリシーは作らない(アプリはサーバーからテーブルの持ち主として接続し、
-- ブラウザから直接DBを読ませないため。Data API はオフ。00_共通設計 1章)
alter table public.work_locations enable row level security;

-- 初期データ: 店舗・工場の2行。
-- 緯度・経度は未確定なので空のまま入れる。訪問のときに位置を確かめ、次のような SQL で入れる:
--   update public.work_locations set latitude = <緯度>, longitude = <経度> where kind = 'store';
--   update public.work_locations set latitude = <緯度>, longitude = <経度> where kind = 'factory';
insert into public.work_locations (name, kind, sort_order) values
  ('店舗（助信駅前店）', 'store', 1),
  ('工場', 'factory', 2);
