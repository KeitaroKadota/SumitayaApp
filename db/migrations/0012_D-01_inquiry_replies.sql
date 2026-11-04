-- 0012 D-01 返信文の案と送信の記録(inquiry_replies)
-- 設計書: D-01 01 6.2(列)、03 EV-10〜EV-14・0.5、04 CH-04・CH-11・CH-12、00_共通設計 3.2
-- 0011 の後に1回だけ実行する。
-- 実際の送信は楽楽自動応対・モールの画面で担当者が行う。ここは「送った」という記録だけを持つ(自動送信はしない)。

create table public.inquiry_replies (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id),
  -- 案の種類(D-02 在庫・D-03 よくある質問・D-04 特注の聞き返し/概算・D-06 返品・手で書いた)
  kind text not null check (kind in ('stock', 'faq', 'custom_ask', 'custom_estimate', 'return', 'free')),
  -- 作り方(AI・ひな形に値を入れた・手で書いた)
  draft_source text not null check (draft_source in ('ai', 'template', 'manual')),
  -- 使ったひな形。参照の制約は reply_templates を作る D-02 の SQL で付ける
  template_id uuid,
  -- AI・ひな形で作った最初の文(直す前)
  ai_draft text check (char_length(ai_draft) <= 10000),
  -- 担当者が確認・修正した文(送る文)
  body text not null check (char_length(body) <= 10000),
  -- 案を作ったときの根拠の値(在庫数・入荷見込日・概算の金額・使ったFAQのID など)
  facts jsonb,
  status text not null default 'draft' check (status in ('draft', 'sent', 'discarded')),
  sent_at timestamptz,
  sent_by uuid references public.employees (id),
  -- 送った画面(CH-12)
  sent_via text check (sent_via in ('rakuraku', 'rakuten', 'yahoo', 'amazon', 'futureshop', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),

  constraint inquiry_replies_sent_check check ((status = 'sent') = (sent_at is not null and sent_via is not null))
);

create index inquiry_replies_inquiry_id_idx on public.inquiry_replies (inquiry_id, created_at);
create index inquiry_replies_status_idx on public.inquiry_replies (status);

create trigger inquiry_replies_set_updated_at
before update on public.inquiry_replies
for each row execute function public.set_updated_at();

alter table public.inquiry_replies enable row level security;
