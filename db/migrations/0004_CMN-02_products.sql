-- 0004 CMN-02 商品(products)と商品コードの読み替え(product_code_aliases)
-- 設計書: CMN-02 01 6.2・6.3(列)・04 CH-08〜CH-14・CH-35〜CH-37、00_共通設計 1章・7.5
-- 0003(suppliers)の後に1回だけ実行する。商品の実データはここに書かない(画面かCSVで登録する)。

-- 1行=1SKU(サイズ・色ちがいは別の行)
create table public.products (
  id uuid primary key default gen_random_uuid(),
  -- 商品コード(CROSS MALL の商品コードと同じ。大文字・小文字を区別する。登録後は変えない)
  product_code text not null unique check (product_code ~ '^[A-Za-z0-9._/-]{1,50}$'),
  -- 品番(サイズ・色ちがいをまとめる親のコード)
  item_code text,
  name text not null,
  size text,
  color text,
  -- JANコード(数字8桁か13桁)
  jan_code text check (jan_code ~ '^(\d{8}|\d{13})$'),
  -- 分類のコード(例: happi)。表示名はプログラムの定数
  category_code text check (category_code ~ '^[A-Za-z0-9_-]{1,20}$'),
  main_supplier_id uuid references public.suppliers (id),
  -- 原価(円・税抜)・売価(円)
  cost_price integer check (cost_price >= 0),
  sell_price integer check (sell_price >= 0),
  sell_price_tax_included boolean not null default true,
  -- 消費税率(%)。10・8・0(00_共通設計 7.5)
  tax_rate smallint not null default 10 check (tax_rate in (10, 8, 0)),
  -- 自社縫製の商品か
  is_in_house boolean not null default false,
  order_lot integer check (order_lot between 1 and 99999),
  min_order_qty integer check (min_order_qty between 1 and 99999),
  -- 空なら主な仕入先の lead_time_days を使う
  lead_time_days integer check (lead_time_days between 0 and 365),
  -- ABC区分(A-02 が書く。この画面では表示だけ)
  abc_rank text check (abc_rank in ('A', 'B', 'C')),
  abc_ranked_at timestamptz,
  note text,
  -- 使用中か(廃番は false。削除はしない)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create index products_item_code_idx on public.products (item_code);
create index products_jan_code_idx on public.products (jan_code);
create index products_category_code_idx on public.products (category_code);
create index products_main_supplier_id_idx on public.products (main_supplier_id);
-- 商品名の部分一致の検索を速くする索引(pg_trgm は 0002 で extensions スキーマに作った)
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

alter table public.products enable row level security;

-- 商品コードの読み替え(POS・CROSS MALL のコードが product_code と違うとき)
create table public.product_code_aliases (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('pos', 'crossmall')),
  external_code text not null check (char_length(external_code) between 1 and 50),
  product_id uuid not null references public.products (id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  unique (source, external_code)
);

create index product_code_aliases_product_id_idx on public.product_code_aliases (product_id);

create trigger product_code_aliases_set_updated_at
before update on public.product_code_aliases
for each row execute function public.set_updated_at();

alter table public.product_code_aliases enable row level security;
