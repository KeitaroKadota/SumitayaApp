-- 0036 A-01 売上(sales_daily)。1行=1日×1販路×1商品コードの合計
-- 設計書: A-01 01 6.1(列)・7.3・7.4、B-01 01 7.5(source = 'orders' の行は B-01 が書く)、00_共通設計 7.3
-- 0035 の後に1回だけ実行する。売上の実データはここに書かない(画面からCSVで取り込む)。

create table public.sales_daily (
  id uuid primary key default gen_random_uuid(),
  -- 売れた日(POSは売上日、CROSS MALL は受注日)
  sales_date date not null,
  -- 販路
  channel text not null check (channel in ('store', 'futureshop', 'rakuten', 'yahoo', 'amazon', 'other')),
  -- 商品コード(CSVの値を整えたもの。読み替えの表で自社のコードに直せたものは自社のコード)
  product_code text not null check (char_length(product_code) between 1 and 50),
  -- 商品マスタの商品(マスタに無いコードは空のまま取り込む。後で結び付け直す)
  product_id uuid references public.products (id),
  -- CSVに書かれていた商品名(マスタに無いときの表示用)
  product_name text check (char_length(product_name) <= 300),
  -- 数量・金額の合計(返品・取消はマイナスで入ってくれば差し引く)。1行の金額は integer に収まる(00_共通設計 7.3)
  quantity integer not null,
  amount_excl_tax integer not null,
  amount_incl_tax integer not null,
  -- 明細の数(何回売れたか。A-02 の出荷頻度)
  line_count integer not null default 0 check (line_count >= 0),
  -- どこから来たか(POSのCSV・CROSS MALL のCSV・B-01 の受注)
  source text not null check (source in ('pos_csv', 'crossmall_csv', 'orders')),
  -- 取り込みの記録(B-01 から積み上げた行は空)
  import_batch_id uuid references public.import_batches (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sales_date, channel, product_code)
);

create index sales_daily_product_id_sales_date_idx on public.sales_daily (product_id, sales_date);
create index sales_daily_sales_date_idx on public.sales_daily (sales_date);
-- 取消(A-01 EV-04)で、その取り込みの行を探す
create index sales_daily_import_batch_id_idx on public.sales_daily (import_batch_id);

create trigger sales_daily_set_updated_at
before update on public.sales_daily
for each row execute function public.set_updated_at();

alter table public.sales_daily enable row level security;
