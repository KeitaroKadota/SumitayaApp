-- 0038 A-03 祭礼・イベントの日程(festival_events)
-- 設計書: A-03 01 6.1、04 CH-05
-- 0037 の後に1回だけ実行する。祭礼の日程は画面(祭礼カレンダー)で登録する。

create table public.festival_events (
  id uuid primary key default gen_random_uuid(),
  -- 同じ祭りを年をまたいでつなぐ名前(例: 浜松まつり)
  series_key text not null check (char_length(series_key) between 1 and 50),
  -- その年の名前(例: 浜松まつり 2027)
  name text not null check (char_length(name) between 1 and 100),
  start_date date not null,
  end_date date not null,
  region text check (char_length(region) <= 100),
  -- 影響を受ける商品の分類(空＝すべての商品。分類は products.category_code)
  category_codes text[] not null default '{}',
  -- 何日前から売れ始めるか・最終日の何日後まで影響するか(【仮】既定 28・0。00_仮決め一覧 A-03-仮-02)
  influence_days_before integer not null default 28 check (influence_days_before between 0 and 120),
  influence_days_after integer not null default 0 check (influence_days_after between 0 and 120),
  -- 補正の倍率(0〜5)
  adjust_factor numeric(4, 2) not null default 1.00 check (adjust_factor between 0 and 5),
  -- 開催するか(中止なら false。予測では倍率0)
  is_held boolean not null default true,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  -- CH-05 日程: 初日 ≦ 最終日、31日以内
  check (start_date <= end_date and end_date - start_date <= 30),
  unique (series_key, start_date)
);

create index festival_events_start_date_idx on public.festival_events (start_date);

create trigger festival_events_set_updated_at
before update on public.festival_events
for each row execute function public.set_updated_at();

alter table public.festival_events enable row level security;
