-- 0013 D-01 AI(Gemini)の呼び出しの記録(ai_requests)
-- 設計書: D-01 01 7.3・7.3.1(列)、03 0.1・0.3、04 CH-06、00_共通設計 3.1・4章・7.4
-- 0012 の後に1回だけ実行する。AIを使うすべての機能(D-01〜D-04・D-06・C-01・E-04・E-07)が書く。
-- 1日の回数はこの表の行で数える(全機能で共有)。AIに渡した文・返ってきた文は残さない(お客様の個人情報を増やさないため)。
-- 目的(purpose)の値は機能が増えるたびに増えるので、DB では決めず src/utils/gemini.ts の表で持つ。

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  -- 機能ID(例: D-01)
  feature_id text not null check (feature_id ~ '^(CMN|[A-E])-\d{2}$'),
  -- 目的(例: classify)
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- 対象のテーブル・ID
  target_table text check (target_table ~ '^[a-z][a-z0-9_]{1,62}$'),
  target_id uuid,
  -- 送った画像・PDFの数(文だけなら0)
  file_count integer not null default 0 check (file_count between 0 and 100),
  model text not null check (char_length(model) between 1 and 100),
  -- started: 呼び出し中 / quota: Google の上限エラー(429)
  status text not null default 'started'
    check (status in ('started', 'success', 'error', 'invalid', 'quota', 'timeout')),
  -- 失敗の理由(短く。お客様の文は入れない)
  error_message text check (char_length(error_message) <= 500),
  prompt_tokens integer check (prompt_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  duration_ms integer check (duration_ms >= 0),
  -- 押した人(定期実行などから呼んだときは空)
  requested_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_requests_created_at_idx on public.ai_requests (created_at);
create index ai_requests_feature_id_created_at_idx on public.ai_requests (feature_id, created_at);

create trigger ai_requests_set_updated_at
before update on public.ai_requests
for each row execute function public.set_updated_at();

alter table public.ai_requests enable row level security;
