-- 0005 CMN-02 取引先(customers)。請求書(E-05)を出す相手(町内会・法人など)
-- 設計書: CMN-02 01 6.5(列)・04 CH-15〜CH-18・CH-34、00_共通設計 1章・7.5
-- 0004 の後に1回だけ実行する。取引先の実データはここに書かない(画面で登録する)。

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  -- 取引先コード。空は除いて重複不可
  customer_code text check (customer_code ~ '^[A-Za-z0-9_-]{1,20}$'),
  -- 請求書の宛名
  name text not null,
  name_kana text,
  -- 【仮】敬称と種別(00_仮決め一覧 CMN02-仮-16)
  honorific text not null default '御中' check (honorific in ('御中', '様')),
  customer_type text not null default 'neighborhood'
    check (customer_type in ('neighborhood', 'corporate', 'school', 'individual', 'other')),
  contact_name text,
  phone text,
  email text,
  postal_code text check (postal_code ~ '^\d{3}-\d{4}$'),
  address text,
  -- 締め日・支払期限。31=月末(00_共通設計 7.5)。締め日が空=都度請求
  closing_day integer check (closing_day between 1 and 31),
  payment_month_offset integer check (payment_month_offset between 0 and 3),
  payment_day integer check (payment_day between 1 and 31),
  -- 振込名義のカナ(全角カタカナ。複数は「、」区切り)。E-06 が読む
  payer_name_kana text check (char_length(payer_name_kana) <= 200),
  note text,
  -- 取引中か(削除はせず false にする)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create unique index customers_customer_code_key on public.customers (customer_code) where customer_code is not null;
create index customers_name_kana_idx on public.customers (name_kana);

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

alter table public.customers enable row level security;
