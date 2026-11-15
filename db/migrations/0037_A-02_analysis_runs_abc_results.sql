-- 0037 A-02 計算の回の記録(analysis_runs。A-03 の予測も使う)と ABC分析の結果(abc_results)
-- 設計書: A-02 01 6.1・6.2、04 CH-05、A-03 01 6.2、00_共通設計 3.1・7.3
-- 0036 の後に1回だけ実行する。

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  -- abc: ABC分析(A-02)/ forecast: 需要予測(A-03)
  kind text not null check (kind in ('abc', 'forecast')),
  -- 集計に使った期間(予測は予測する期間を settings に持つ)
  period_from date not null,
  period_to date not null,
  -- 計算したときの定数の値の写し
  settings jsonb not null default '{}'::jsonb,
  -- 件数など
  summary jsonb not null default '{}'::jsonb,
  -- A-02 は計算と同時に反映するので applied だけを書く。A-03 は calculated
  status text not null check (status in ('calculated', 'applied', 'discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  applied_by uuid references public.employees (id),
  applied_at timestamptz,
  check (period_from <= period_to)
);

create index analysis_runs_kind_created_at_idx on public.analysis_runs (kind, created_at);

create trigger analysis_runs_set_updated_at
before update on public.analysis_runs
for each row execute function public.set_updated_at();

alter table public.analysis_runs enable row level security;

create table public.abc_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.analysis_runs (id) on delete cascade,
  -- 商品(マスタに無いコードは空。商品マスタへは反映しない)
  product_id uuid references public.products (id),
  product_code text not null,
  -- 期間の販売金額(税抜・円)。期間の合計なので bigint(00_共通設計 7.3)
  sales_amount bigint not null,
  sales_quantity integer not null,
  -- 期間の出荷頻度(明細の数)
  frequency integer not null,
  -- 割合(%)
  amount_share numeric(7, 4) not null,
  amount_cum_share numeric(7, 4) not null,
  frequency_cum_share numeric(7, 4) not null,
  -- CH-05 ランクの値
  amount_rank text not null check (amount_rank in ('A', 'B', 'C')),
  frequency_rank text not null check (frequency_rank in ('A', 'B', 'C')),
  rank text not null check (rank in ('A', 'B', 'C')),
  -- 計算した時点の商品マスタのランク
  previous_rank text check (previous_rank in ('A', 'B', 'C')),
  is_new_product boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, product_code)
);

create index abc_results_product_id_idx on public.abc_results (product_id);

create trigger abc_results_set_updated_at
before update on public.abc_results
for each row execute function public.set_updated_at();

alter table public.abc_results enable row level security;
