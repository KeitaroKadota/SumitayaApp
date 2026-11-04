-- 0027 E-05 発行する請求書(invoices)・明細(invoice_lines)
-- 設計書: E-05 01 4.1・4.2・6.1・6.2(列)、03 の 0章・EV-05〜EV-12、04 CH-05・CH-06・CH-10〜CH-12、00_共通設計 3.3・7.3・7.5
-- 0026 の後に1回だけ実行する(customers・products・employees を参照する)。
-- 担当は E-05。入金の列(payment_status・paid_amount・paid_on)は E-06 が書く。
-- 金額は円の整数。明細の数量は numeric(10,2)(生地のメートルなど。00_共通設計 7.3)。
-- 日付の列は 00_共通設計 7.5 に合わせて _on にした(設計書の issue_date → issued_on、transaction_date → transaction_on)。
-- 発行した請求書は直せない・消せない(訂正か取消。CH-10)。アプリの操作で状態を確かめて守る。

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  -- 請求書番号(YYYYMM-NNN。発行のときに付ける。下書きは空。CH-12)
  invoice_no text check (invoice_no ~ '^\d{6}-\d{3}$'),
  -- draft: 下書き / issued: 発行済み / void: 取消
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  -- 取引先(CMN-02)。下書きのあいだは空でよい(CH-04 は発行のときに確かめる)
  customer_id uuid references public.customers (id),
  -- 宛名・敬称・郵便番号・住所・担当者(発行のときに取引先から写して固定する。0.3)
  customer_name text check (char_length(customer_name) <= 100),
  customer_honorific text check (customer_honorific in ('御中', '様')),
  customer_postal_code text check (char_length(customer_postal_code) <= 10),
  customer_address text check (char_length(customer_address) <= 200),
  customer_contact text check (char_length(customer_contact) <= 100),
  -- 件名
  subject text check (char_length(subject) <= 100),
  -- 発行日(請求日)。下書きでも入れておく(初期値は今日)
  issued_on date,
  -- 取引の期間(明細ごとに日付を書かないとき)
  period_start date,
  period_end date,
  -- お支払期限
  due_on date,
  -- exclusive: 税抜で入力(外税) / inclusive: 税込で入力(内税)
  price_basis text not null default 'exclusive' check (price_basis in ('exclusive', 'inclusive')),
  -- 税率ごとの合計(税抜)と消費税額。サーバーで計算した値だけを入れる(CH-06)
  subtotal_10 integer not null default 0,
  tax_10 integer not null default 0,
  subtotal_8 integer not null default 0,
  tax_8 integer not null default 0,
  subtotal_exempt integer not null default 0,
  subtotal integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  -- 発行者(自社の情報から発行のときに写す。0.3)
  issuer_name text check (char_length(issuer_name) <= 100),
  issuer_registration_no text check (issuer_registration_no ~ '^T\d{13}$'),
  issuer_postal_code text check (char_length(issuer_postal_code) <= 10),
  issuer_address text check (char_length(issuer_address) <= 200),
  issuer_tel text check (char_length(issuer_tel) <= 20),
  bank_text text check (char_length(bank_text) <= 300),
  -- 備考
  note text check (char_length(note) <= 1000),
  -- 消費税の端数処理(発行のときの company_settings.rounding を写す。下書きは計算に使った方法)
  rounding text not null default 'floor' check (rounding in ('floor', 'round', 'ceil')),
  -- 訂正のとき、差し替える前の請求書
  replaces_invoice_id uuid references public.invoices (id),
  issued_at timestamptz,
  issued_by uuid references public.employees (id),
  void_reason text check (char_length(void_reason) between 1 and 200),
  voided_at timestamptz,
  voided_by uuid references public.employees (id),
  -- 入金の状態(E-06 が書く。unpaid: 未入金 / partial: 一部入金(初回は使わない) / paid: 入金済み)
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  paid_amount integer check (paid_amount >= 0),
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  -- CH-06 合計の食い違いを入れられないようにする(01 の 6.1)
  constraint invoices_subtotal_check check (subtotal = subtotal_10 + subtotal_8 + subtotal_exempt),
  constraint invoices_tax_check check (tax = tax_10 + tax_8),
  constraint invoices_total_check check (total = subtotal + tax),
  -- 発行済み・取消は、番号・宛名・発行者・登録番号・発行日がある(CH-02〜CH-04・CH-12)
  constraint invoices_issued_check check (
    status = 'draft'
    or (invoice_no is not null and customer_name is not null and issuer_name is not null
        and issuer_registration_no is not null and issued_on is not null and issued_at is not null)
  ),
  -- 発行するときはご請求額が1円以上(CH-05)
  constraint invoices_total_positive_check check (status = 'draft' or total >= 1),
  check (status <> 'void' or (void_reason is not null and voided_at is not null)),
  check (period_start is null or period_end is null or period_start <= period_end)
);

-- CH-12 請求書番号は重ならない(下書きの空は除く)
create unique index invoices_invoice_no_key on public.invoices (invoice_no) where invoice_no is not null;
-- EV-10 1つの請求書への訂正の下書きは1つだけ
create unique index invoices_replaces_draft_key on public.invoices (replaces_invoice_id)
  where replaces_invoice_id is not null and status = 'draft';
-- 一覧(状態・発行日)と、取引先での絞り込み
create index invoices_status_issued_on_idx on public.invoices (status, issued_on);
create index invoices_customer_idx on public.invoices (customer_id);

create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  -- 親の請求書(下書きを削除したら一緒に消す。発行済みは消さない)
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  -- 並び順(1〜100。CH-05)
  line_no integer not null check (line_no between 1 and 100),
  -- 取引の日(納品日)。空なら請求書の期間を使う(CH-08)
  transaction_on date,
  -- 商品マスタから選んだとき
  product_id uuid references public.products (id),
  -- 品名・内容(発行のときは空でない。CH-05)
  description text not null default '' check (char_length(description) <= 100),
  -- 数量(小数2けたまで)。下書きのあいだは空でよい
  quantity numeric(10, 2) check (quantity >= 0 and quantity <= 99999.99),
  unit text check (char_length(unit) <= 10),
  -- 単価(price_basis に合わせて税抜または税込)。値引きの行はマイナス
  unit_price integer check (unit_price between -9999999 and 9999999),
  -- 金額 = 数量 × 単価(1円未満は切り捨て。サーバーで計算した値だけを入れる。CH-06)
  amount integer not null default 0,
  tax_rate smallint not null default 10 check (tax_rate in (10, 8, 0)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_lines_line_no_key unique (invoice_id, line_no)
);

create trigger invoice_lines_set_updated_at
before update on public.invoice_lines
for each row execute function public.set_updated_at();

alter table public.invoice_lines enable row level security;
