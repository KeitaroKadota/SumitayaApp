-- 0028 E-06 入金を確かめる銀行口座(bank_accounts)
-- 設計書: E-06 01 6.1(列)・9章、02 G04、03 EV-10、04 CH-02・CH-12、00_共通設計 3.3
-- 0027 の後に1回だけ実行する(employees を参照する)。
-- 口座はすみたや様の実データなので、ここには初期データを入れない(画面 G04 から登録する)。
-- 口座番号は下4けただけを持つ(全部は持たない。01 9章)。口座は削除せず is_active = false にする(EV-10)。

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  -- 銀行名(必須・50文字まで)・支店名(50文字まで。CH-12)
  bank_name text not null check (char_length(bank_name) between 1 and 50),
  branch_name text check (char_length(branch_name) <= 50),
  -- ordinary: 普通 / current: 当座
  account_type text not null default 'ordinary' check (account_type in ('ordinary', 'current')),
  -- 口座番号の下4けた(画面で見分ける用)
  account_number_last4 text check (account_number_last4 ~ '^\d{4}$'),
  -- ネットバンキングがあるか
  has_online_banking boolean not null default false,
  -- 明細CSVの形(src/utils/bankCsv.ts の BANK_CSV_FORMATS のキー)。空なら取り込めない。
  -- 形を足すときはアプリの定数だけを直す(ここでは値の一覧を CHECK しない)
  csv_format text check (char_length(csv_format) <= 30),
  -- 消込の対象にするか
  is_target boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  -- CH-12 ネットバンキングなしの口座には CSV の形を設定できない
  constraint bank_accounts_csv_format_check check (csv_format is null or has_online_banking)
);

create index bank_accounts_sort_idx on public.bank_accounts (is_active, sort_order);

create trigger bank_accounts_set_updated_at
before update on public.bank_accounts
for each row execute function public.set_updated_at();

alter table public.bank_accounts enable row level security;
