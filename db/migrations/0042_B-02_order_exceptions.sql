-- 0042 B-02 例外注文の理由(order_exceptions)
-- 設計書: B-02 01 6.1(列)・7章、03 EV-01〜EV-04、04 CH-01〜CH-04・CH-12・CH-13・CH-16〜CH-19、00_共通設計 3.5
-- 0034 の後に1回だけ実行する(orders・employees を参照する)。
-- 1行＝1つの注文が1つのルールに当たったこと。同じ注文・同じルールは1行だけ(取り込み直しても2回作らない)。
-- ルールの決まり・キーワードはプログラム(src/utils/orderExceptionRules.ts)の定数に持つ(テーブルにしない。B-02 01 0.3)。
-- 自動で作ったときは created_by・updated_by は空。

create table public.order_exceptions (
  id uuid primary key default gen_random_uuid(),
  -- 注文を消すと一緒に消える
  order_id uuid not null references public.orders (id) on delete cascade,
  -- 当たったルールのコード(01 4.1)。scroll360_only・custom_order・made_to_order・maker_order は No.40 の4つ、
  -- name_print・address・unpaid・bundle は計画書の4観点
  rule_code text not null check (
    rule_code in ('scroll360_only', 'custom_order', 'made_to_order', 'maker_order', 'name_print', 'address', 'unpaid', 'bundle')
  ),
  -- 画面に出す理由の文(例: 「備考に『刺繍』があります」「郵便番号が6桁です」)
  reason text not null check (char_length(reason) between 1 and 1000),
  -- 当たった値(キーワード、明細の行など)
  detail jsonb,
  -- open: 未対応 / resolved: 対応済み
  status text not null default 'open' check (status in ('open', 'resolved')),
  -- 最後に調べ直したときも、まだ当たっているか(取り込み直しで直った場合 false。自動で対応済みにはしない)
  still_matches boolean not null default true,
  -- 対応のメモ(CH-13。500文字以下)
  resolution_note text check (char_length(resolution_note) <= 500),
  resolved_by uuid references public.employees (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  constraint order_exceptions_order_rule_key unique (order_id, rule_code),
  constraint order_exceptions_resolved_check check (status <> 'resolved' or resolved_at is not null)
);

-- G01 の一覧(状態・ルールで絞り込む)
create index order_exceptions_status_rule_idx on public.order_exceptions (status, rule_code);

create trigger order_exceptions_set_updated_at
before update on public.order_exceptions
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.order_exceptions enable row level security;
