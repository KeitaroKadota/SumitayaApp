-- 0011 D-01 問い合わせ(inquiries)
-- 設計書: D-01 01 4.1・4.2・6.1(列)、04 CH-01〜CH-05・CH-09・CH-10、00_共通設計 3.2
-- 0010 の後に1回だけ実行する(employees・import_batches を参照する)。
-- 1件＝受け取った1通。続きのメッセージは parent_inquiry_id で最初の問い合わせにつなぐ。

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  -- 続きのメッセージのとき、最初の問い合わせのID
  parent_inquiry_id uuid references public.inquiries (id),
  -- 経路(メール〔自社・楽楽自動応対〕・各モール・自社ショップ・その他)
  channel text not null check (channel in ('email', 'rakuten', 'yahoo', 'amazon', 'futureshop', 'other')),
  -- 取り込み方法(貼り付け・CSV・将来のAPI)
  source text not null check (source in ('paste', 'csv', 'api')),
  -- CSVで取り込んだときの取り込みの記録
  import_batch_id uuid references public.import_batches (id),
  -- 楽楽自動応対の問い合わせ番号・モールのメッセージ番号など(重複の確認に使う。CH-05)
  external_id text check (char_length(external_id) between 1 and 100),
  -- 経路・メールアドレス・件名・本文から作った重複確認用の値(SHA-256 の16進。CH-05)
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- お客様から届いた日時
  received_at timestamptz not null,
  customer_name text check (char_length(customer_name) <= 100),
  -- 小文字にそろえて保存する(CH-03)
  customer_email text check (char_length(customer_email) <= 254),
  subject text check (char_length(subject) <= 300),
  body text not null check (char_length(body) between 1 and 20000),
  -- 種類(空＝未分類)。AIのまま(ai)か、担当者が選んだ・直した(manual)か
  category text check (category in ('stock', 'return', 'faq', 'custom', 'other')),
  category_source text check (category_source in ('ai', 'manual')),
  -- AIが出した種類・自信・要約・抜き出した情報(直した後も種類は残す。AIの正しさを測るため)
  ai_category text check (ai_category in ('stock', 'return', 'faq', 'custom', 'other')),
  ai_confidence text check (ai_confidence in ('high', 'medium', 'low')),
  ai_summary text check (char_length(ai_summary) <= 200),
  -- 抜き出した情報(D-01 01 6.3 の形)。担当者が直した値もここに上書きする
  ai_extracted jsonb,
  ai_classified_at timestamptz,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'waiting', 'replied', 'closed', 'ignored')),
  -- 担当者
  assigned_to uuid references public.employees (id),
  -- 初めて「送信済み」にした日時(効果測定⑥)
  first_replied_at timestamptz,
  -- 完了・対応不要にした日時
  closed_at timestamptz,
  -- 社内メモ(お客様には出さない)
  memo text check (char_length(memo) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),

  constraint inquiries_category_pair_check check ((category is null) = (category_source is null)),
  constraint inquiries_not_own_parent_check check (parent_inquiry_id is null or parent_inquiry_id <> id)
);

-- CH-05 同じ経路に同じ問い合わせ番号は1件だけ(番号があるときだけ)
create unique index inquiries_channel_external_id_key on public.inquiries (channel, external_id)
  where external_id is not null;

create index inquiries_status_received_at_idx on public.inquiries (status, received_at);
create index inquiries_category_idx on public.inquiries (category);
create index inquiries_customer_email_idx on public.inquiries (customer_email);
create index inquiries_content_hash_idx on public.inquiries (content_hash);
create index inquiries_parent_inquiry_id_idx on public.inquiries (parent_inquiry_id);

create trigger inquiries_set_updated_at
before update on public.inquiries
for each row execute function public.set_updated_at();

alter table public.inquiries enable row level security;
