-- 0039 A-03 発注(purchase_orders)と発注の明細(purchase_order_lines)
-- 設計書: A-03 01 4.1・6.4・6.5・7.1、04 CH-08・CH-09、C-02 01 6.3、00_共通設計 3.4・7.3・7.5
-- 0038 の後に1回だけ実行する。
-- 入荷済みの数(received_qty)と、状態 partially_received・received への移り変わりは、
-- C-02 が A-03 の recordReceipt(src/utils/purchaseOrders.ts)を呼んで書く。

-- 発注番号(PO-000123 の数字の部分)
create sequence public.purchase_order_no_seq;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  -- 発注番号(PO-000123 の形)
  order_no text not null unique check (order_no ~ '^PO-[0-9]{6,}$'),
  supplier_id uuid not null references public.suppliers (id),
  -- 状態(01 4.1。承認の段階は 0.3 で外した)
  status text not null default 'draft'
    check (status in ('draft', 'ordered', 'partially_received', 'received', 'closed', 'cancelled')),
  -- suggestion: 提案から / manual: 手で作った
  source text not null check (source in ('suggestion', 'manual')),
  -- 提案から作ったときの計算の回
  run_id uuid references public.analysis_runs (id),
  -- 発注日(「発注した」を記録した日)・入荷予定日
  order_date date,
  expected_date date,
  send_method text check (send_method in ('fax', 'email', 'web', 'phone', 'other')),
  -- 金額(税抜の合計・税額・税込)。1件の発注の金額なので integer(00_共通設計 7.3)
  subtotal integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  -- 仕入先への連絡事項(発注書に出す)・社内のメモ(出さない)
  note text check (char_length(note) <= 500),
  internal_note text check (char_length(internal_note) <= 500),
  ordered_by uuid references public.employees (id),
  ordered_at timestamptz,
  closed_by uuid references public.employees (id),
  closed_at timestamptz,
  cancelled_by uuid references public.employees (id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create index purchase_orders_supplier_id_status_idx on public.purchase_orders (supplier_id, status);
create index purchase_orders_status_idx on public.purchase_orders (status);
create index purchase_orders_created_at_idx on public.purchase_orders (created_at);

create trigger purchase_orders_set_updated_at
before update on public.purchase_orders
for each row execute function public.set_updated_at();

alter table public.purchase_orders enable row level security;

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  line_no integer not null check (line_no >= 1),
  product_id uuid not null references public.products (id),
  -- 仕入先の品番(C-01 の supplier_item_codes にあれば入れる)
  supplier_item_code text check (char_length(supplier_item_code) <= 100),
  -- 発注したときの商品名
  product_name text not null check (char_length(product_name) <= 300),
  -- 提案の数(手で足した行は空)
  suggested_qty integer,
  -- 発注する数(自社の単位)
  quantity integer not null check (quantity between 1 and 99999),
  -- 単価(税抜・自社の単位あたり・円)
  unit_price integer not null default 0 check (unit_price between 0 and 9999999),
  tax_rate smallint not null default 10 check (tax_rate in (10, 8, 0)),
  -- 数×単価(税抜)
  amount integer not null default 0,
  -- 入荷済みの数(C-02 が recordReceipt で足す)
  received_qty integer not null default 0 check (received_qty >= 0),
  -- 明細ごとの入荷予定日(空なら発注の expected_date)
  expected_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, line_no)
);

create index purchase_order_lines_product_id_idx on public.purchase_order_lines (product_id);

create trigger purchase_order_lines_set_updated_at
before update on public.purchase_order_lines
for each row execute function public.set_updated_at();

alter table public.purchase_order_lines enable row level security;
