-- 0043 C-01 納品書(delivery_slips)・納品書の明細(delivery_slip_lines)
-- 設計書: C-01 01 9.1・9.2(列)、03 EV-05〜EV-11、04 CH-04〜CH-12、C-02 01 6.1(C-02 が書く列)、00_共通設計 3.6・7.3
-- 0042 の後に1回だけ実行する(suppliers・products・stored_files・ai_requests・received_invoices・tasks・employees を参照する)。
-- 担当は C-01。照合・検収の列(purchase_order_id・match_status など)は C-02 が書くが、C-02 の 01 6.1 のとおりここで作る。
-- E-04 は received_invoice_id を(C-02 の linkSlipsToInvoice を通して)書く。金額は円の整数。数量は numeric(10,2)(00_共通設計 7.3)。
-- 発注(purchase_orders・purchase_order_lines。A-03 が並行で作っている)と在庫の記録(inventory_movements。B-03。まだ無い)を
-- 参照する purchase_order_id・purchase_order_line_id・movement_id には外部キーを付けていない(C-02 を作るときに付ける)。

create table public.delivery_slips (
  id uuid primary key default gen_random_uuid(),
  -- 納品書の画像・PDF(stored_files.id)。ページ順。1〜5ページ(CH-04)
  file_ids uuid[] not null check (cardinality(file_ids) between 1 and 5),
  -- 読み取りの状態: pending 待ち / reading 読み取り中 / done 読み取り済み / failed 失敗 / manual 手入力
  read_status text not null default 'pending' check (read_status in ('pending', 'reading', 'done', 'failed', 'manual')),
  -- 伝票の状態: draft 確かめ中 / confirmed 確定(C-02 へ) / needs_review C-02 で人の確認待ち / accepted 検収済み / cancelled 取消。
  -- needs_review・accepted は C-02 が書く。E-04 は accepted で取り出す
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'needs_review', 'accepted', 'cancelled')),
  -- 読み取りの見直しで印がある、または信頼度が低い(C-01 01 7.3。C-02 は「読取信頼度が低い」として人に回す)
  needs_check boolean not null default false,
  -- 仕入先。確定には必須(CH-10)。E-04 が仕入先で取り出す
  supplier_id uuid references public.suppliers (id),
  -- AIが読んだ仕入先の名前(そのまま)
  supplier_name_read text check (char_length(supplier_name_read) <= 200),
  slip_no text check (char_length(slip_no) <= 50),
  -- 納品日。確定には必須(CH-10)
  delivery_date date,
  -- 伝票に書かれた発注番号(C-02 の照合の手がかり)
  order_ref text check (char_length(order_ref) <= 50),
  -- 明細の金額が税込で書かれているか
  tax_included boolean not null default false,
  -- 税抜の合計・税額・税込の合計(円)。税込の伝票の税抜は 合計 − 税
  subtotal integer check (subtotal between 0 and 99999999),
  tax integer check (tax between 0 and 99999999),
  total integer check (total between 0 and 99999999),
  -- AIが返した伝票全体の信頼度(0〜1)
  confidence numeric(3, 2) check (confidence between 0 and 1),
  -- 見直しで付いた印(項目と理由の配列。[{"field": "total", "message": "…"}])
  check_flags jsonb not null default '[]'::jsonb,
  -- 読み取りに使ったAIの呼び出しと、AIが返した結果そのまま(直す前の値を残す)
  ai_request_id uuid references public.ai_requests (id),
  ai_result jsonb,
  note text check (char_length(note) <= 1000),
  -- 確定した人・日時
  confirmed_by uuid references public.employees (id),
  confirmed_at timestamptz,

  -- ---- ここから C-02 が書く列(C-02 01 6.1) ----
  -- 照合した発注(purchase_orders.id。外部キーは C-02 で付ける)
  purchase_order_id uuid,
  -- 照合の結果のまとめ: auto_accepted 自動で検収 / needs_review 要確認 / reviewed 人が判断して検収 / no_order 発注なしで検収
  match_status text check (match_status in ('auto_accepted', 'needs_review', 'reviewed', 'no_order')),
  -- 要確認の理由の一覧
  review_reasons jsonb,
  matched_at timestamptz,
  -- 検収した人(自動なら空)・日時
  accepted_by uuid references public.employees (id),
  accepted_at timestamptz,
  -- 人が判断したときの理由
  accept_note text check (char_length(accept_note) <= 1000),
  -- 確認を頼んだタスク(CMN-03)
  task_id uuid references public.tasks (id),
  -- ---- C-02 が書く列ここまで ----

  -- この納品書を含む受け取った請求書(E-04 が C-02 の linkSlipsToInvoice を通して書く)
  received_invoice_id uuid references public.received_invoices (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  constraint delivery_slips_confirmed_check
    check (status in ('draft', 'cancelled') or (supplier_id is not null and delivery_date is not null and total is not null))
);

-- E-04 が仕入先と期間で取り出す・CH-11 同じ伝票番号を探す・一覧の状態
create index delivery_slips_supplier_date_idx on public.delivery_slips (supplier_id, delivery_date);
create index delivery_slips_supplier_slip_no_idx on public.delivery_slips (supplier_id, slip_no);
create index delivery_slips_status_idx on public.delivery_slips (status);
-- CH-03・CH-04 ファイルがどの納品書に使われているか
create index delivery_slips_file_ids_idx on public.delivery_slips using gin (file_ids);

create trigger delivery_slips_set_updated_at
before update on public.delivery_slips
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.delivery_slips enable row level security;

-- ---- 納品書の明細 ----
create table public.delivery_slip_lines (
  id uuid primary key default gen_random_uuid(),
  -- 納品書を消すと一緒に消える(読み取り直したときは明細を入れ直す)
  slip_id uuid not null references public.delivery_slips (id) on delete cascade,
  line_no integer not null check (line_no between 1 and 100),
  -- 仕入先の品番(前後の空白を取り、全角英数字を半角に、大文字にそろえる。CH-06)
  supplier_item_code text check (char_length(supplier_item_code) <= 50),
  -- 品名(読めなかったときは空。確定には必須。CH-10)
  item_name text not null default '' check (char_length(item_name) <= 100),
  -- サイズ・色など
  spec text check (char_length(spec) <= 100),
  -- 数量(伝票の単位のまま。小数2けた。返品はマイナス)・単位
  -- 読めなかったときは空(確定には必須。CH-10)。設計書は空不可だが、確かめ中の下書きを残すため空を許す
  quantity numeric(10, 2) check (quantity between -99999.99 and 99999.99),
  unit text check (char_length(unit) <= 20),
  -- 単価・金額(円。金額は伝票の書き方のまま。税込か税抜かは delivery_slips.tax_included。値引きはマイナス)
  unit_price integer check (unit_price between -99999999 and 99999999),
  amount integer check (amount between -99999999 and 99999999),
  -- 自社の商品(対応表、または人が選ぶ)。在庫の商品なら確定に必須(CH-10)
  product_id uuid references public.products (id),
  -- 在庫にしない品(送料・加工賃・消耗品など)
  is_non_stock boolean not null default false,
  -- AIが返した明細の信頼度
  confidence numeric(3, 2) check (confidence between 0 and 1),
  -- 見直しの印([{"field": "amount", "message": "…"}])
  check_flags jsonb not null default '[]'::jsonb,
  -- 人が直したか(AIの読み取りの精度を測るため)
  is_edited boolean not null default false,

  -- ---- ここから C-02 が書く列(C-02 01 6.1) ----
  -- 結び付けた発注の明細(purchase_order_lines.id。外部キーは C-02 で付ける)
  purchase_order_line_id uuid,
  -- 明細ごとの照合の結果(値の一覧は C-02 01 5.2。C-02 で CHECK を足す)
  match_result text check (char_length(match_result) <= 30),
  -- 自社の単位にそろえた数(数量 × 入数)
  units_quantity numeric(12, 2),
  -- 照合した時点の発注の残り・発注の単価
  expected_quantity integer,
  expected_unit_price integer,
  -- 検収で受け入れた数(自社の単位・整数)
  accepted_quantity integer,
  -- 作った在庫の記録(inventory_movements.id。外部キーは C-02 で付ける)
  movement_id uuid,
  -- ---- C-02 が書く列ここまで ----

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_slip_lines_slip_line_key unique (slip_id, line_no)
);

create index delivery_slip_lines_product_id_idx on public.delivery_slip_lines (product_id);

create trigger delivery_slip_lines_set_updated_at
before update on public.delivery_slip_lines
for each row execute function public.set_updated_at();

alter table public.delivery_slip_lines enable row level security;
