-- 0015 D-03 よくある質問と回答(faq_entries)
-- 設計書: D-03 01 4.1(話題)・6.1(列)、04 CH-05・CH-06、00_共通設計 3.2
-- 0014 の後に1回だけ実行する。
-- よくある質問の文(自社サイト・祭塾の内容)はここに書かない(画面かCSVで登録する。00_仮決め一覧 D-03-仮-02)。

create table public.faq_entries (
  id uuid primary key default gen_random_uuid(),
  -- 話題(D-01 の抜き出した情報 faq_topics と同じ値)
  topic text not null check (topic in ('size', 'shipping', 'delivery', 'payment', 'care', 'other')),
  question text not null check (char_length(question) between 1 and 200),
  -- お客様にそのまま見せてよい書き方の回答
  answer text not null check (char_length(answer) between 1 and 3000),
  -- 探すときのことば(空白区切り)
  keywords text check (char_length(keywords) <= 200),
  -- 根拠(自社サイト・祭塾・お店の決まり)
  source_name text not null check (source_name in ('site', 'matsurijuku', 'store')),
  -- 元のページのURL(CH-06)
  source_url text check (char_length(source_url) <= 500 and source_url ~ '^https?://'),
  -- 元のページと同じか確かめた日
  checked_on date,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  -- 使う／使わない(消さない)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create index faq_entries_topic_is_active_idx on public.faq_entries (topic, is_active);

create trigger faq_entries_set_updated_at
before update on public.faq_entries
for each row execute function public.set_updated_at();

alter table public.faq_entries enable row level security;
