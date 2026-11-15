-- 0040 A-03 需要の予測(demand_forecasts)と発注の提案と理由(replenishment_suggestions)
-- 設計書: A-03 01 4.2・6.2・6.3、03 EV-02
-- 0039 の後に1回だけ実行する。
-- 【仮】1年より古い回の行は、予測を計算したときに消す(発注に結び付いた提案は残す。00_仮決め一覧 A-03-仮-07)

create table public.demand_forecasts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.analysis_runs (id) on delete cascade,
  product_id uuid not null references public.products (id),
  -- 予測する週の月曜日
  week_start date not null,
  -- last_year: 去年から / recent_average: 直近の平均 / no_data: 予測0
  method text not null check (method in ('last_year', 'recent_average', 'no_data')),
  -- 手順1・2の基準
  base_qty numeric(10, 2) not null default 0,
  -- 手順2で合わせた祭り
  festival_event_id uuid references public.festival_events (id) on delete set null,
  -- 去年の何日前の売上を使ったか(ふだんは 364)
  shift_days integer not null default 364,
  growth_rate numeric(6, 3) not null default 1,
  growth_basis text not null default 'product' check (growth_basis in ('product', 'category', 'store')),
  festival_factor numeric(4, 2) not null default 1,
  bias_factor numeric(5, 3) not null default 1,
  -- 四捨五入する前の値と、予測の数
  forecast_value numeric(10, 2) not null default 0,
  forecast_qty integer not null default 0 check (forecast_qty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, product_id, week_start)
);

-- 手順5「その週が始まる前の最後の計算の予測」を探す
create index demand_forecasts_product_id_week_start_idx on public.demand_forecasts (product_id, week_start);

create trigger demand_forecasts_set_updated_at
before update on public.demand_forecasts
for each row execute function public.set_updated_at();

alter table public.demand_forecasts enable row level security;

create table public.replenishment_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.analysis_runs (id) on delete cascade,
  product_id uuid not null references public.products (id),
  -- purchase: 仕入先へ発注 / production: 工場で作る候補 / no_supplier: 仕入先が未登録
  destination text not null check (destination in ('purchase', 'production', 'no_supplier')),
  supplier_id uuid references public.suppliers (id),
  abc_rank text check (abc_rank in ('A', 'B', 'C')),
  lead_time_days integer not null,
  review_weeks numeric(4, 1) not null,
  on_hand_qty integer not null,
  on_order_qty integer not null,
  lead_time_demand integer not null,
  safety_stock integer not null,
  reorder_point integer not null,
  -- 0 なら発注しない
  suggested_qty integer not null default 0 check (suggested_qty >= 0),
  reason text not null,
  -- 下書きにしたら、その発注の明細(明細を消したら空に戻る)
  purchase_order_line_id uuid references public.purchase_order_lines (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, product_id)
);

create index replenishment_suggestions_purchase_order_line_id_idx on public.replenishment_suggestions (purchase_order_line_id);

create trigger replenishment_suggestions_set_updated_at
before update on public.replenishment_suggestions
for each row execute function public.set_updated_at();

alter table public.replenishment_suggestions enable row level security;
