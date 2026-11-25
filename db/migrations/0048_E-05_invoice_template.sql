-- 0048 E-05 すみたや様の請求書のひな形に合わせる(郵便振替・FAX・お届け先・明細の摘要・請求書番号の新しい形)
-- 設計書: E-05 01 の 11章、03・04 の 0.5 追記、00_仮決め一覧 E-05-仮-16〜18
-- 0047 の後に1回だけ実行する。

-- 自社の情報: 郵便振替の口座番号(例 12370-46186061)
alter table public.company_settings
  add column postal_transfer_no text check (char_length(postal_transfer_no) <= 30);

-- 請求書: 発行のときに写す FAX・郵便振替の文、お届け先
alter table public.invoices
  add column issuer_fax text check (char_length(issuer_fax) <= 20),
  add column postal_transfer_text text check (char_length(postal_transfer_text) <= 100),
  add column ship_to_name text check (char_length(ship_to_name) <= 100),
  add column ship_to_postal_code text check (char_length(ship_to_postal_code) <= 10),
  add column ship_to_address text check (char_length(ship_to_address) <= 200),
  add column ship_to_tel text check (char_length(ship_to_tel) <= 20);

-- 請求書番号: 新しい形 INV-YYYYMMDD-NNN。今までの YYYYMM-NNN もそのまま有効にする
-- (0027 で付けた CHECK は自動の名前なので、名前を調べて外す)
do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%invoice_no%~%'
  loop
    execute format('alter table public.invoices drop constraint %I', c);
  end loop;
end $$;

alter table public.invoices
  add constraint invoices_invoice_no_format_check
    check (invoice_no ~ '^INV-\d{8}-\d{3}$' or invoice_no ~ '^\d{6}-\d{3}$');

-- 明細: 摘要
alter table public.invoice_lines
  add column remark text check (char_length(remark) <= 100);
