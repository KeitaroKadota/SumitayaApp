-- 0035 A-01 小さな設定(app_settings)。キーと jsonb の値
-- 設計書: A-01 01 6.4、00_共通設計 1章・3.1・7.5(キーは機能ごとに1行。値の中に項目を持つ)
-- 0034 の後に1回だけ実行する。設定を変える画面は作らない(値は開発者が SQL で入れる。行が無ければ既定値で動く)。
-- A-01 が使うキー: sales({"crossmall_cutover_date": "YYYY-MM-DD", "tax_rate": 10})

create table public.app_settings (
  -- 設定のキー(<機能の名前> の形。例: sales)
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{0,49}$'),
  value jsonb not null,
  -- 最後に直した人
  updated_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
