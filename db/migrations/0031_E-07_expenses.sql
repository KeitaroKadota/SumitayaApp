-- 0031 E-07 経費(expenses)
-- 設計書: E-07 01 4.1(状態)・6.1(列)、03 の 0章・EV-01〜EV-18、04 CH-02〜CH-19、00_共通設計 3.3・7.3
-- 0030 の後に1回だけ実行する(employees・stored_files・ai_requests・account_titles を参照する)。
-- 担当は E-07。金額は円の整数。精算済みの状態・列は持たない(01 の 0.3 で外した)。
-- 下書き(draft)は撮影の直後に作るため、支払った日・支払先は空でよい。申請(submitted)より後は必須(CH-04)。

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  -- 申請した人
  applicant_id uuid not null references public.employees (id),
  -- draft: 下書き / submitted: 承認待ち / returned: 差し戻し / approved: 承認済み / withdrawn: 取り下げ
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved', 'withdrawn')),
  -- 領収書の画像。領収書が無いもの(バス・電車の運賃など)は空。撮り直した前の画像は stored_files に残す(EV-05)
  receipt_file_id uuid references public.stored_files (id),
  -- 領収書がない理由(receipt_file_id が空のときは申請で必須。CH-08)
  no_receipt_reason text check (char_length(no_receipt_reason) <= 100),
  -- 読み取りに使ったAIの呼び出しと、AIが読み取ったままの値(人が直しても残す)
  ai_request_id uuid references public.ai_requests (id),
  ai_raw jsonb,
  -- 支払った日(領収書の日付)
  spent_on date,
  -- 支払先(店の名前)と、そろえた名前(履歴・二重計上の確かめに使う。01 7.2)
  payee_name text check (char_length(payee_name) <= 100),
  payee_key text check (char_length(payee_key) <= 100),
  -- 領収書の登録番号(T＋13けた)。形が違うものも残し、画面で注意を出す(CH-13)ので、形の CHECK はしない
  registration_no text check (char_length(registration_no) <= 20),
  -- 支払った合計(税込)と、税率ごとの金額(税込)・消費税額、消費税がかからないもの
  total integer not null default 0 check (total between 0 and 9999999),
  total_10 integer not null default 0 check (total_10 between 0 and 9999999),
  tax_10 integer not null default 0 check (tax_10 between 0 and 9999999),
  total_8 integer not null default 0 check (total_8 between 0 and 9999999),
  tax_8 integer not null default 0 check (tax_8 between 0 and 9999999),
  total_exempt integer not null default 0 check (total_exempt between 0 and 9999999),
  -- cash: 現金で立て替え / personal_card: 自分のカード / company_card: 会社のカード / other
  payment_method text not null default 'cash' check (payment_method in ('cash', 'personal_card', 'company_card', 'other')),
  -- 品目の要約・用途のメモ・交際費や会議費のときの相手先と人数
  items_text text check (char_length(items_text) <= 200),
  purpose text check (char_length(purpose) <= 200),
  attendees text check (char_length(attendees) <= 200),
  -- 勘定科目と、どの方法で決めたか(history: 同じ支払先の履歴 / ai: AIの案 / manual: 人が選んだ)と、その理由の文
  account_title_id uuid references public.account_titles (id),
  account_title_source text check (account_title_source in ('history', 'ai', 'manual')),
  account_title_reason text check (char_length(account_title_reason) <= 200),
  -- チェックの印(04 の CH のID。例: {CH-09,CH-12})。1つ以上あれば「要確認」
  check_flags text[] not null default '{}',
  -- 二重計上の疑いの相手
  duplicate_of uuid references public.expenses (id),
  -- 申請した日時(取り下げて下書きに戻しても残す。一度も申請していない下書きだけを削除できる。EV-10)
  submitted_at timestamptz,
  -- 承認した人・日時・ひとこと(要確認を承認したときは必須。CH-14)
  approved_by uuid references public.employees (id),
  approved_at timestamptz,
  approve_note text check (char_length(approve_note) <= 200),
  -- 差し戻した人・日時・理由(申請し直しても経緯として残す。EV-08 手順5)
  returned_by uuid references public.employees (id),
  returned_at timestamptz,
  return_reason text check (char_length(return_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  -- CH-05 合計は内訳の合計。下書きは読み取ったまま(合わないことがある)を残し、画面で「⚠ 要確認」を出すため除く
  constraint expenses_total_breakdown_check check (status = 'draft' or total = total_10 + total_8 + total_exempt),
  -- 申請より後は、支払った日・支払先・合計が入っている(CH-04)
  constraint expenses_submitted_fields_check
    check (status in ('draft', 'withdrawn') or (spent_on is not null and payee_name is not null and total >= 1)),
  check (status <> 'approved' or (account_title_id is not null and approved_at is not null)),
  check (status <> 'returned' or return_reason is not null)
);

-- 1つの領収書の画像は1つの経費にだけ使う
create unique index expenses_receipt_file_id_key on public.expenses (receipt_file_id) where receipt_file_id is not null;
-- 自分の経費の一覧(G01)
create index expenses_applicant_spent_idx on public.expenses (applicant_id, spent_on);
-- 承認の一覧(G03)・CSV
create index expenses_status_spent_idx on public.expenses (status, spent_on);
-- 勘定科目の履歴(03 の 0.2)・二重計上の疑い(CH-09)
create index expenses_payee_key_idx on public.expenses (payee_key, spent_on);
create index expenses_spent_total_idx on public.expenses (spent_on, total);

create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.expenses enable row level security;
