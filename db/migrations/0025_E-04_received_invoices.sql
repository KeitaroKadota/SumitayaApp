-- 0025 E-04 受け取った請求書(received_invoices)・明細(received_invoice_lines)
-- 設計書: E-04 01 4.1・6.1・6.2(列)、03 の 0章・EV-03〜EV-10、04 CH-04〜CH-19、00_共通設計 3.3・7.3・7.5
-- 0024 の後に1回だけ実行する(suppliers・stored_files・ai_requests・employees を参照する)。
-- 担当は E-04。金額は円の整数。明細の数量は numeric(10,2)(生地のメートルなど。00_共通設計 7.3)。
-- 納品書(delivery_slips。C-01)・発注の明細(purchase_order_lines。A-03)はまだ無いので、
-- delivery_slip_id・purchase_order_line_id には外部キーを付けていない(それぞれの機能を作るときに付ける)。

create table public.received_invoices (
  id uuid primary key default gen_random_uuid(),
  -- reading: 読み取り中 / needs_review: 確認待ち / scheduled: 支払予定 / cancelled: 取消
  status text not null check (status in ('reading', 'needs_review', 'scheduled', 'cancelled')),
  -- purchase: 仕入れ(突合する) / other: その他(突合しない)
  kind text not null check (kind in ('purchase', 'other')),
  -- 仕入先。仕入先マスタに無い相手(電力会社など)は空
  supplier_id uuid references public.suppliers (id),
  -- 請求元の名前(読み取ったまま、または手入力)
  payee_name text check (char_length(payee_name) <= 100),
  -- 請求元の登録番号(T＋13けた)。形が違うものも残し、確認待ちの理由にする(CH-03)ので、形の CHECK はしない
  registration_no text check (char_length(registration_no) <= 20),
  invoice_no text check (char_length(invoice_no) <= 50),
  -- 請求書の日付(発行日)。読み取りの前・読めなかったときは空
  invoice_date date,
  -- 請求の期間(前回の締めの翌日〜今回の締め日)
  period_start date,
  period_end date,
  -- 前回ご請求額・ご入金額・繰越額(参考。読み取れたときだけ)
  previous_balance integer check (previous_balance between 0 and 99999999),
  payment_received integer check (payment_received between 0 and 99999999),
  carried_over integer check (carried_over between 0 and 99999999),
  -- 税率ごとの金額(税抜)と消費税額、消費税がかからない金額
  subtotal_10 integer not null default 0 check (subtotal_10 between 0 and 99999999),
  tax_10 integer not null default 0 check (tax_10 between 0 and 99999999),
  subtotal_8 integer not null default 0 check (subtotal_8 between 0 and 99999999),
  tax_8 integer not null default 0 check (tax_8 between 0 and 99999999),
  subtotal_exempt integer not null default 0 check (subtotal_exempt between 0 and 99999999),
  -- 今回のお買上げ額(税込)= 上の合計(CH-05)
  purchase_total integer not null default 0,
  -- 今回ご請求額(支払う額)。繰越があればそれを含む
  amount_due integer not null default 0 check (amount_due between 0 and 99999999),
  -- 支払予定日と、その出どころ(invoice: 請求書に書いてある / terms: 締め日・支払日から計算 / manual: 手入力)
  due_on date,
  due_date_source text check (due_date_source in ('invoice', 'terms', 'manual')),
  payment_method text check (payment_method in ('transfer', 'debit', 'cash', 'other')),
  -- 振込先(読み取った文字のまま)
  transfer_to text check (char_length(transfer_to) <= 200),
  -- 突合の結果(matched: 一致 / difference: 差異あり / no_data: 照合できるデータなし / not_applicable: その他の請求書)
  match_result text not null default 'no_data' check (match_result in ('matched', 'difference', 'no_data', 'not_applicable')),
  -- 結び付いた検収済みの納品書の合計(税込)と、purchase_total − matched_total
  matched_total integer,
  difference_amount integer,
  -- 確認待ちの理由(04 の CH のID。例: {CH-08,CH-11})
  review_reasons text[] not null default '{}',
  -- 請求書の画像・PDF(手入力のときは空でよい。1つのファイルは1つの請求書にだけ使う)
  file_id uuid references public.stored_files (id),
  -- 読み取りに使ったAIの呼び出しと、AIが読み取ったままの値(人が直しても残す)
  ai_request_id uuid references public.ai_requests (id),
  ai_raw jsonb,
  -- 人が確認した人・日時と、確認のメモ(差異の理由など)
  reviewed_by uuid references public.employees (id),
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  -- 取消の理由
  cancel_reason text check (char_length(cancel_reason) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  -- CH-05 お買上げ額は税率ごとの金額の合計
  constraint received_invoices_purchase_total_check
    check (purchase_total = subtotal_10 + tax_10 + subtotal_8 + tax_8 + subtotal_exempt),
  check (period_start is null or period_end is null or period_start <= period_end),
  check (due_on is null or due_date_source is not null),
  check (status <> 'cancelled' or cancel_reason is not null)
);

create unique index received_invoices_file_id_key on public.received_invoices (file_id) where file_id is not null;
-- 突合・二重登録の確認(仕入先と締め日)
create index received_invoices_supplier_period_idx on public.received_invoices (supplier_id, period_end);
-- 一覧・支払予定(状態と支払予定日)
create index received_invoices_status_due_idx on public.received_invoices (status, due_on);
create index received_invoices_invoice_date_idx on public.received_invoices (invoice_date);

create trigger received_invoices_set_updated_at
before update on public.received_invoices
for each row execute function public.set_updated_at();

alter table public.received_invoices enable row level security;

create table public.received_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  -- 親の請求書(削除したら一緒に消す。請求書は取消にするだけで削除しない)
  received_invoice_id uuid not null references public.received_invoices (id) on delete cascade,
  -- 並び順(1〜200。CH-17)
  line_no integer not null check (line_no between 1 and 200),
  -- 納品日・取引日、伝票番号(納品書の番号)
  line_date date,
  slip_no text check (char_length(slip_no) <= 50),
  -- 品名・内容
  description text not null default '' check (char_length(description) <= 200),
  -- 仕入先の品番
  item_code text check (char_length(item_code) <= 50),
  -- 数量(小数2けたまで)・単価(税抜)・金額(税抜)
  quantity numeric(10, 2) check (quantity between 0 and 9999999.99),
  unit_price integer check (unit_price between 0 and 99999999),
  amount integer not null check (amount between 0 and 99999999),
  tax_rate smallint not null check (tax_rate in (10, 8, 0)),
  -- 結び付いた納品書(C-02 の delivery_slips)と、単価を比べた発注の明細(A-03)
  delivery_slip_id uuid,
  purchase_order_line_id uuid,
  -- 突合の結果(manual_ok: 人が差異を認めた)
  match_status text not null default 'not_applicable'
    check (match_status in ('matched', 'amount_diff', 'price_diff', 'not_found', 'manual_ok', 'not_applicable')),
  diff_amount integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint received_invoice_lines_line_no_key unique (received_invoice_id, line_no)
);

create index received_invoice_lines_delivery_slip_idx on public.received_invoice_lines (delivery_slip_id)
  where delivery_slip_id is not null;

create trigger received_invoice_lines_set_updated_at
before update on public.received_invoice_lines
for each row execute function public.set_updated_at();

alter table public.received_invoice_lines enable row level security;
