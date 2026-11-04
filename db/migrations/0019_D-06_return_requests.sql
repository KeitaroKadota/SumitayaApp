-- 0019 D-06 返品の依頼(return_requests)・返品する商品(return_request_items)
-- 設計書: D-06 01 4.1・6.2・6.3(列)、03 EV-06・EV-10、04 CH-02〜CH-06、00_共通設計 3.2・7.5
-- 0018 の後に1回だけ実行する(inquiries・orders・order_items・products・employees を参照する)。
-- 担当は D-06。商品が届いたこと(item_arrived_at・received_qty・状態 item_arrived)は B-03 が書く(初回は作らないので空のまま)。
-- 返品の決まりの判定・返金・完了の記録は持たない(D-06 01 0.3)。

create table public.return_requests (
  id uuid primary key default gen_random_uuid(),
  -- 返品の番号(RT-年-通し番号。年ごとに1から)
  return_number text not null unique check (return_number ~ '^RT-[0-9]{4}-[0-9]{4,}$'),
  -- 元の問い合わせ(続きのメッセージがあれば最初の問い合わせ)
  inquiry_id uuid not null references public.inquiries (id),
  -- 注文(見つからないときは空)
  order_id uuid references public.orders (id),
  -- お客様が書いた注文番号(注文が見つからないときの記録)
  order_number text check (char_length(order_number) <= 100),
  -- 販路(注文から写す)
  channel text check (channel in ('futureshop', 'rakuten', 'yahoo', 'amazon', 'other')),
  customer_name text check (char_length(customer_name) <= 200),
  request_type text not null check (request_type in ('return', 'exchange')),
  reason text not null check (reason in ('size', 'defect', 'wrong_item', 'damaged', 'changed_mind', 'other')),
  reason_note text check (char_length(reason_note) <= 1000),
  -- 返送の送料の負担(担当者が選ぶ)
  shipping_paid_by text not null check (shipping_paid_by in ('store', 'customer')),
  status text not null check (status in ('waiting_item', 'item_arrived', 'rejected', 'cancelled')),
  -- 商品が届いた日時(B-03 が書く)
  item_arrived_at timestamptz,
  memo text check (char_length(memo) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create index return_requests_inquiry_id_idx on public.return_requests (inquiry_id);
create index return_requests_order_id_idx on public.return_requests (order_id);
create index return_requests_status_idx on public.return_requests (status, created_at);

create trigger return_requests_set_updated_at
before update on public.return_requests
for each row execute function public.set_updated_at();

alter table public.return_requests enable row level security;

-- ---- 返品する商品(1件の返品に複数の商品) ----
create table public.return_request_items (
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid not null references public.return_requests (id) on delete cascade,
  -- 注文の明細(手で入れたときは空)。
  -- 【仮】B-01 は取り込み直すたびに明細を消して入れ直すため、消えたら空にする(取り込みを止めないため。00_仮決め一覧 D-06-仮-12)
  order_item_id uuid references public.order_items (id) on delete set null,
  product_id uuid references public.products (id),
  -- 商品名(注文の明細から写す。手で入れたときはその名前)
  product_name text not null check (char_length(product_name) between 1 and 300),
  quantity integer not null check (quantity between 1 and 9999),
  -- 注文時の単価(税込・円)
  unit_price integer,
  -- 交換の場合、交換先の商品
  exchange_product_id uuid references public.products (id),
  -- 届いた(入荷済みの)数(B-03 が書く)
  received_qty integer check (received_qty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index return_request_items_return_request_id_idx on public.return_request_items (return_request_id);
create index return_request_items_order_item_id_idx on public.return_request_items (order_item_id);

create trigger return_request_items_set_updated_at
before update on public.return_request_items
for each row execute function public.set_updated_at();

alter table public.return_request_items enable row level security;
