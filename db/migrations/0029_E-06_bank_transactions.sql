-- 0029 E-06 銀行の入出金明細と消込の結果(bank_transactions)
-- 設計書: E-06 01 6.2(列)、03 の 0章・EV-03〜EV-09、04 CH-04〜CH-10、00_共通設計 3.3・7.5
-- 0028 の後に1回だけ実行する(bank_accounts・import_batches・invoices・employees を参照する)。
-- 取り込んだCSVのファイルそのものは保存しない(中身の行だけ。01 9章)。
-- 日付の列は 00_共通設計 7.5 に合わせて _on にした(設計書の txn_date → transaction_on)。
-- 1つの入金は1つの請求書だけ、1つの請求書には入金は1つだけ(初回。00_仮決め一覧 E-06-仮-02)。

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts (id),
  -- 取り込みの記録(A-01 の import_batches。種類 bank_transactions)
  import_batch_id uuid not null references public.import_batches (id),
  -- 取引日
  transaction_on date not null,
  -- 摘要(そのまま。200文字まで。CH-03)
  description text not null default '' check (char_length(description) <= 200),
  -- 振込依頼人の名前(摘要から取り出したもの。入金だけ)
  payer_name text check (char_length(payer_name) <= 200),
  -- 入金額・出金額(どちらか一方だけが1以上。CH-03)
  deposit integer not null default 0 check (deposit >= 0),
  withdrawal integer not null default 0 check (withdrawal >= 0),
  -- 残高(空可。マイナスも可)
  balance bigint,
  -- 口座＋取引日＋摘要＋入金＋出金＋残高 から作った値(SHA-256 の16進。CH-04)
  row_hash text not null,
  -- unmatched: 未消込 / matched: 消込済み / ignored: 対象外(出金もこれで登録する。CH-05)
  match_status text not null check (match_status in ('unmatched', 'matched', 'ignored')),
  -- いちばん点数の高い候補(取り込みのとき・消込を外したとき・対象外を戻したときに計算する。03 0.1)
  suggested_invoice_id uuid references public.invoices (id),
  -- 消し込んだ請求書(E-05)
  invoice_id uuid references public.invoices (id),
  -- 差し引かれた振込手数料(なければ0)
  fee_amount integer not null default 0 check (fee_amount >= 0),
  matched_by uuid references public.employees (id),
  matched_at timestamptz,
  -- 対象外の理由(「利息」「出金」など)
  ignore_reason text check (char_length(ignore_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_transactions_amount_check check ((deposit > 0) <> (withdrawal > 0)),
  -- CH-05 出金は対象外だけ
  constraint bank_transactions_deposit_or_ignored_check check (deposit > 0 or match_status = 'ignored'),
  -- 消込済みのときだけ請求書・消し込んだ人・日時がある
  constraint bank_transactions_matched_check check (
    (match_status = 'matched' and invoice_id is not null and matched_at is not null)
    or (match_status <> 'matched' and invoice_id is null and matched_at is null and fee_amount = 0)
  ),
  check (match_status <> 'ignored' or ignore_reason is not null)
);

-- CH-04 同じ明細を二重に取り込まない(口座ごと)
create unique index bank_transactions_row_hash_key on public.bank_transactions (bank_account_id, row_hash);
-- CH-07 1つの請求書に入金は1つ(初回)
create unique index bank_transactions_invoice_key on public.bank_transactions (invoice_id) where invoice_id is not null;
-- 一覧(口座・取引日)と、取り込みの取消(EV-09)
create index bank_transactions_account_date_idx on public.bank_transactions (bank_account_id, transaction_on);
create index bank_transactions_batch_idx on public.bank_transactions (import_batch_id);
create index bank_transactions_status_idx on public.bank_transactions (match_status) where deposit > 0;

create trigger bank_transactions_set_updated_at
before update on public.bank_transactions
for each row execute function public.set_updated_at();

alter table public.bank_transactions enable row level security;
