-- 0041 A-05 在庫の指標の記録(inventory_kpi_daily。1日1行)
-- 設計書: A-05 01 5章・6.1、03 の 0.1、04 CH-01・CH-04、00_共通設計 7.3
-- 0040 の後に1回だけ実行する。
-- 書く: A-05 の recordInventoryKpi(src/utils/inventoryKpi.ts)。B-01 の在庫の取り込みの後と、画面を開いたときに呼ぶ。

create table public.inventory_kpi_daily (
  id uuid primary key default gen_random_uuid(),
  kpi_date date not null unique,
  -- 使った在庫数の時点(inventory_levels の最後の更新日時)
  inventory_as_of timestamptz,
  total_qty integer not null default 0,
  -- 金額は原価(税抜・円)。合計・期間の列なので bigint(00_共通設計 7.3)
  total_value bigint not null default 0,
  missing_cost_count integer not null default 0,
  cogs_365 bigint not null default 0,
  avg_value_365 bigint not null default 0,
  kpi_days integer not null default 0,
  -- 平均在庫金額が0なら空(「−」と表示。CH-04)
  turnover numeric(6, 2),
  stagnant_value bigint not null default 0,
  stagnant_count integer not null default 0,
  target_count integer not null default 0,
  stockout_count integer not null default 0,
  -- 対象が0品なら空(CH-04)
  stockout_rate numeric(6, 4),
  -- 計算したときの定数の値(滞留の日数など)
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger inventory_kpi_daily_set_updated_at
before update on public.inventory_kpi_daily
for each row execute function public.set_updated_at();

alter table public.inventory_kpi_daily enable row level security;
