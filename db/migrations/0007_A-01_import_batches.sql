-- 0007 A-01 CSV取り込みの記録(import_batches)。取り込みの共通の仕組み(確認→登録の2段階)が使う
-- 設計書: A-01 01 6.2(列)・04 CH-05・CH-06、00_共通設計 3.1・7.5
-- 0006 の後に1回だけ実行する。CMN-02 の商品の取り込みで先に使うため、ここで作る。
-- 確認の結果(行の中身)や元のファイルは保存しない。件数と指紋だけを残す。

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  -- 取り込みの種類。足すときは A-01 01 6.2 の表と一緒に直す
  kind text not null check (kind in (
    'sales_pos', 'sales_crossmall', 'crossmall_orders', 'crossmall_stock',
    'products', 'bank_transactions', 'inquiries', 'faq_entries'
  )),
  -- 取り込み元(人がCSVを選んだ・定期の自動取り込み)
  source text not null default 'csv' check (source in ('csv', 'api')),
  -- ファイルの情報(API の取り込みでは空)
  file_name text,
  file_size integer check (file_size >= 0),
  -- ファイルの中身から作った指紋(SHA-256 の16進)
  file_hash text,
  encoding text check (encoding in ('utf8', 'shift_jis')),
  data_row_count integer not null default 0 check (data_row_count >= 0),
  period_from date,
  period_to date,
  -- 分類ごとの件数(登録のときの値で上書きする)
  add_count integer not null default 0,
  change_count integer not null default 0,
  same_count integer not null default 0,
  delete_count integer not null default 0,
  skip_count integer not null default 0,
  error_count integer not null default 0,
  status text not null check (status in ('previewed', 'applied', 'cancelled', 'failed')),
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 確認した人(API の取り込みでは空)
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  applied_by uuid references public.employees (id),
  applied_at timestamptz,
  cancelled_by uuid references public.employees (id),
  cancelled_at timestamptz
);

create index import_batches_kind_created_at_idx on public.import_batches (kind, created_at);
create index import_batches_kind_file_hash_idx on public.import_batches (kind, file_hash);

create trigger import_batches_set_updated_at
before update on public.import_batches
for each row execute function public.set_updated_at();

alter table public.import_batches enable row level security;
