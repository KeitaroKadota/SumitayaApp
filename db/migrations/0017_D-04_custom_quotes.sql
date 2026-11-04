-- 0017 D-04 特注の案件(custom_quotes)
-- 設計書: D-04 01 4.1・4.3・6.1(列)、03 EV-02〜EV-14、04 CH-01〜CH-12、00_共通設計 3.2
-- 0016 の後に1回だけ実行する(inquiries・employees・custom_price_items を参照する)。
-- 担当は D-04。見込み顧客の列 lead_id は D-05 が書く(D-05 は初回は作らないので、列だけ先に作る)。

create table public.custom_quotes (
  id uuid primary key default gen_random_uuid(),
  -- 案件の番号(TK-年-通し番号。年ごとに1から。工場とのやり取りで使う)
  quote_number text not null unique check (quote_number ~ '^TK-[0-9]{4}-[0-9]{4,}$'),
  -- 元の問い合わせ(続きのメッセージがあれば最初の問い合わせ)
  inquiry_id uuid not null references public.inquiries (id),
  organization_name text check (char_length(organization_name) <= 100),
  customer_name text check (char_length(customer_name) <= 100),
  -- 連絡先(工場への依頼の印刷物には出さない)
  customer_email text check (char_length(customer_email) <= 254),
  customer_phone text check (char_length(customer_phone) <= 20),
  -- 品目(単価表の縫製の行の品目の値)
  item_type text check (char_length(item_type) <= 100),
  fabric_item_id uuid references public.custom_price_items (id),
  -- 生地の希望(単価表に無い・未定のとき)
  fabric_note text check (char_length(fabric_note) <= 1000),
  -- サイズごとの枚数(例: [{"size":"M","qty":10},{"size":"L","qty":20}])
  size_breakdown jsonb,
  -- 合計の枚数
  quantity integer check (quantity between 0 and 9999),
  -- 名入れの方法(単価表の名入れの行)。「なし」は print_none
  print_item_id uuid references public.custom_price_items (id),
  print_none boolean not null default false,
  -- 名入れの文字・場所
  print_text text check (char_length(print_text) <= 1000),
  -- 希望納期(使う日)
  desired_date date,
  -- そのほかの仕様のメモ
  spec_note text check (char_length(spec_note) <= 1000),
  -- 足りない項目の名前(保存のたびに計算し直す)
  missing_items text[] not null default '{}',
  status text not null default 'hearing'
    check (status in ('hearing', 'estimated', 'factory_requested', 'won', 'lost', 'cancelled')),
  -- 概算(税抜・税・税込)と内訳(単価表の行ID・名前・単価・数・金額)
  estimate_subtotal integer check (estimate_subtotal >= 0),
  estimate_tax integer check (estimate_tax >= 0),
  estimate_total integer check (estimate_total >= 0),
  estimate_lines jsonb,
  estimated_at timestamptz,
  -- 工場へ見積を依頼した日時・内容(依頼したときの仕様のまとめと、担当者のメモ)・記録した人
  factory_requested_at timestamptz,
  factory_request_text text check (char_length(factory_request_text) <= 5000),
  factory_requested_by uuid references public.employees (id),
  -- 失注・取消の理由
  closed_reason text check (char_length(closed_reason) <= 100),
  won_at timestamptz,
  closed_at timestamptz,
  -- 見込み顧客(leads、D-05)。leads を作る D-05 の SQL で参照の制約を付ける
  lead_id uuid,
  assigned_to uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),

  -- CH-02 名入れは「方法を選ぶ」か「なし」のどちらか一方
  constraint custom_quotes_print_check check (not (print_none and print_item_id is not null)),
  constraint custom_quotes_estimate_check check (
    (estimate_total is null) = (estimate_subtotal is null)
    and (estimate_total is null) = (estimate_tax is null)
    and (estimate_total is null) = (estimated_at is null)
  )
);

-- CH-01 同じ問い合わせに、取消でない案件は1件だけ
create unique index custom_quotes_inquiry_id_active_key on public.custom_quotes (inquiry_id) where status <> 'cancelled';

create index custom_quotes_status_idx on public.custom_quotes (status, created_at);
create index custom_quotes_inquiry_id_idx on public.custom_quotes (inquiry_id);

create trigger custom_quotes_set_updated_at
before update on public.custom_quotes
for each row execute function public.set_updated_at();

alter table public.custom_quotes enable row level security;
