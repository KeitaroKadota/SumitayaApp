-- 0018 B-01 受注(orders)・受注の明細(order_items)・商品ごとの在庫(inventory_levels)
-- 設計書: B-01 01 6.1〜6.3(列)、03 EV-04・EV-06、04 CH-06・CH-13、00_共通設計 3.5・7.3・7.5
-- 0017 の後に1回だけ実行する(import_batches・products を参照する)。
-- CROSS MALL の受注CSV・在庫CSVを取り込んで上書きする。人が画面で直す列はないので created_by・updated_by は持たない
-- (だれが取り込んだかは import_batches に残る)。

-- ---- 受注(1件＝CROSS MALL の受注1件) ----
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  -- CROSS MALL の受注番号(管理番号)。取り込み直したときに同じ注文を見分けるキー
  crossmall_order_no text not null unique check (char_length(crossmall_order_no) between 1 and 100),
  -- 販路
  shop text not null check (shop in ('futureshop', 'rakuten', 'yahoo', 'amazon', 'other')),
  -- 各モールの注文番号(お客様が問い合わせで書く番号。D-06 の検索に使う)
  shop_order_no text check (char_length(shop_order_no) <= 100),
  ordered_at timestamptz not null,
  -- CROSS MALL 上の状態をそのまま持つ(値の一覧は No.49 待ち)
  crossmall_status text check (char_length(crossmall_status) <= 100),
  -- キャンセルされたか(crossmall_status から決める。CH-06)
  is_cancelled boolean not null default false,
  shipped_on date,
  customer_name text not null default '' check (char_length(customer_name) <= 200),
  customer_kana text not null default '' check (char_length(customer_kana) <= 200),
  -- 前後の空白を取り、小文字にそろえて持つ(CH-06)
  customer_email text check (char_length(customer_email) <= 254),
  -- CSVのまま
  customer_phone text check (char_length(customer_phone) <= 50),
  -- 電話番号を数字だけにした値(検索用。CH-13)
  customer_phone_digits text check (customer_phone_digits ~ '^[0-9]{1,20}$'),
  ship_name text not null default '' check (char_length(ship_name) <= 200),
  -- ハイフンなし7桁に整えて持つ(7桁にならなければCSVの文字のまま。CH-06)
  ship_postal_code text check (char_length(ship_postal_code) <= 20),
  ship_prefecture text check (char_length(ship_prefecture) <= 20),
  ship_address1 text check (char_length(ship_address1) <= 300),
  ship_address2 text check (char_length(ship_address2) <= 300),
  ship_phone text check (char_length(ship_phone) <= 50),
  -- 支払方法(CSVの文字のまま)
  payment_method text check (char_length(payment_method) <= 100),
  payment_status text not null default 'unknown' check (payment_status in ('paid', 'unpaid', 'unknown')),
  requested_delivery_date date,
  -- お客様の備考・要望(B-02 が調べる)
  customer_note text check (char_length(customer_note) <= 5000),
  -- 金額(円。00_共通設計 7.3)
  subtotal integer not null default 0,
  shipping_fee integer not null default 0,
  discount integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  -- 例外の状態(B-02 が書く)
  exception_status text not null default 'none' check (exception_status in ('none', 'open', 'resolved')),
  -- 取り込んだCSVの元の行(列名→値)。1注文が複数の行のときは行の並び(配列)
  raw_row jsonb not null,
  -- 最後に取り込んだときの取り込みの記録
  import_batch_id uuid references public.import_batches (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- D-02・D-06 の検索のため(01 の 6.1)。crossmall_order_no は重複不可の制約で索引が付く
create index orders_shop_order_no_idx on public.orders (shop_order_no);
create index orders_customer_email_idx on public.orders (customer_email);
create index orders_customer_phone_digits_idx on public.orders (customer_phone_digits);
create index orders_ordered_at_idx on public.orders (ordered_at);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

-- ---- 受注の明細 ----
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  -- 注文を消すと一緒に消える
  order_id uuid not null references public.orders (id) on delete cascade,
  line_no integer not null check (line_no >= 1),
  -- CROSS MALL の商品コード(SKU)
  product_code text not null check (char_length(product_code) between 1 and 100),
  -- 商品マスタで商品コードが一致したもの。見つからなければ空(CH-08)
  product_id uuid references public.products (id),
  product_name text not null default '' check (char_length(product_name) <= 300),
  -- 選んだ項目(サイズ・色・名入れの文字など。CSVのまま)
  option_text text check (char_length(option_text) <= 2000),
  -- 名入れ・加工があるか・その内容(CH-06)
  has_customization boolean not null default false,
  customization_text text check (char_length(customization_text) <= 2000),
  quantity integer not null check (quantity >= 1),
  unit_price integer not null default 0,
  amount integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, line_no)
);

create index order_items_product_id_idx on public.order_items (product_id);
create index order_items_product_code_idx on public.order_items (product_code);

create trigger order_items_set_updated_at
before update on public.order_items
for each row execute function public.set_updated_at();

alter table public.order_items enable row level security;

-- ---- 商品ごとの在庫 ----
create table public.inventory_levels (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  -- 置き場所。初回は main だけ(【仮】No.38。00_仮決め一覧 B-01-仮-02)
  location_code text not null default 'main' check (location_code ~ '^[a-z0-9_]{1,20}$'),
  -- 在庫数(CROSS MALL の在庫CSVの値。初回はこれを正とする。B-01 だけが書く)
  quantity integer not null check (quantity between -99999 and 99999),
  -- 引当済みの数・引き当て可能な数(CSVにあれば入れる)
  allocated_quantity integer check (allocated_quantity between -99999 and 99999),
  available_quantity integer check (available_quantity between -99999 and 99999),
  -- 在庫の時点(CROSS MALL から取り込んだ時刻)
  synced_at timestamptz not null,
  -- 1つ前の取り込みのときの在庫数
  previous_quantity integer,
  -- 最後に棚卸で数えた日時(B-04 が書く)
  last_counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, location_code)
);

create trigger inventory_levels_set_updated_at
before update on public.inventory_levels
for each row execute function public.set_updated_at();

alter table public.inventory_levels enable row level security;
