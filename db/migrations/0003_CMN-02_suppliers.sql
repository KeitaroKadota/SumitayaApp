-- 0003 CMN-02 仕入先(suppliers)
-- 設計書: CMN-02 01 6.4(列)・04 CH-16〜CH-19・CH-31〜CH-33、00_共通設計 1章・7.5
-- 0002 の後に1回だけ実行する。仕入先の実データはここに書かない(画面で登録する)。

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  -- 仕入先コード(商品CSVの「主な仕入先コード」で使う)。空は除いて重複不可
  supplier_code text check (supplier_code ~ '^[A-Za-z0-9_-]{1,20}$'),
  name text not null,
  -- ふりがな(ひらがなで保存)
  name_kana text,
  -- 別名(伝票・請求書に書かれる会社名の書き方の違い)。10件まで
  aliases text[] not null default '{}' check (cardinality(aliases) <= 10),
  contact_name text,
  phone text,
  fax text,
  email text,
  postal_code text check (postal_code ~ '^\d{3}-\d{4}$'),
  address text,
  order_method text check (order_method in ('fax', 'email', 'web', 'phone', 'other')),
  -- 発注から届くまでの日数(暦の日数)
  lead_time_days integer check (lead_time_days between 0 and 365),
  -- 適格請求書の登録番号(インボイス)
  registration_no text check (registration_no ~ '^T\d{13}$'),
  -- 締め日・支払日。31=月末。その月に無い日は、その月の最後の日として扱う(00_共通設計 7.5)
  closing_day integer check (closing_day between 1 and 31),
  payment_month_offset integer check (payment_month_offset between 0 and 3),
  payment_day integer check (payment_day between 1 and 31),
  payment_method text check (payment_method in ('transfer', 'debit', 'cash', 'other')),
  transfer_to text check (char_length(transfer_to) <= 200),
  -- 読み取りの注意(C-01・E-04 で AI に渡す手がかり)
  ocr_hint text check (char_length(ocr_hint) <= 500),
  note text,
  -- 取引中か(削除はせず false にする)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create unique index suppliers_supplier_code_key on public.suppliers (supplier_code) where supplier_code is not null;
create index suppliers_name_kana_idx on public.suppliers (name_kana);

create trigger suppliers_set_updated_at
before update on public.suppliers
for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;
