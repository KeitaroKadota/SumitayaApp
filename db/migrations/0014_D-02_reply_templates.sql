-- 0014 D-02 返信のひな形(reply_templates)
-- 設計書: D-02 01 6.2(列)・6.3(差し込み欄)、04 CH-08〜CH-10、D-03 01 6.2、00_共通設計 3.2
-- 0013 の後に1回だけ実行する。担当は D-02(管理の画面は D-02 で作る)。D-03 が先に使うため、ここで作る。
-- ひな形の文はここに書かない(過去の問い合わせメールの例が届いてから、画面で登録する。D-02 01 6.2)。

create table public.reply_templates (
  id uuid primary key default gen_random_uuid(),
  -- 種類(在庫・よくある質問・返品・特注・共通〔あいさつ・署名など〕)
  category text not null check (category in ('stock', 'faq', 'return', 'custom', 'common')),
  -- 用途(例: stock_available・faq_answer・signature)。種類との組み合わせは画面の保存で確かめる(D-02 CH-10)。
  -- D-04・D-06 の用途が後から足されるため、DB の CHECK にはしない
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{0,49}$'),
  -- 画面で選ぶときに出す名前(CH-09)
  name text not null check (char_length(name) between 1 and 50),
  -- 件名の案
  subject text check (char_length(subject) <= 200),
  -- 本文。差し込み欄を {…} で書く(CH-08)
  body text not null check (char_length(body) between 1 and 5000),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  -- 使う／使わない(消さない)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create index reply_templates_category_purpose_idx on public.reply_templates (category, purpose, sort_order);

-- CH-10 署名(common・signature)で「使う」になっているものは1件だけ
create unique index reply_templates_active_signature_key on public.reply_templates (purpose)
  where category = 'common' and purpose = 'signature' and is_active;

create trigger reply_templates_set_updated_at
before update on public.reply_templates
for each row execute function public.set_updated_at();

alter table public.reply_templates enable row level security;

-- D-01 の返信の案(0012)の「使ったひな形」に参照の制約を付ける(0012 のコメントのとおり)
alter table public.inquiry_replies
  add constraint inquiry_replies_template_id_fkey foreign key (template_id) references public.reply_templates (id);
