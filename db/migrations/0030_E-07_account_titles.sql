-- 0030 E-07 勘定科目(account_titles)と初期データ
-- 設計書: E-07 01 6.2(列・初期データ)・7.1、03 の 0.1・0.2、04 CH-11・CH-12・CH-14、00_共通設計 3.3
-- 0029 の後に1回だけ実行する(employees を参照する)。expenses(0031)より先に入れる。
-- 担当は E-07。管理の画面は作らない(01 の 0.3)。科目の追加・名前の変更・使わない印(is_active)は、この形の SQL で直す。
-- 削除はしない(過去の経費が ID で科目を指しているため。使わなくなった科目は is_active = false にする)。

create table public.account_titles (
  id uuid primary key default gen_random_uuid(),
  -- 会計ソフト(エプソン 財務会計)の科目コード。未調査のため空でよい(01 11章 #3)
  code text check (char_length(code) between 1 and 20),
  -- 名前(消耗品費 など)。CH-11・CH-12 は名前(交際費・会議費・消耗品費)で判定する
  name text not null check (char_length(name) between 1 and 50),
  -- 説明(AIに科目を選ばせるときに渡す。01 7.1)
  description text not null default '' check (char_length(description) <= 200),
  sort_order integer not null default 0,
  -- 使っているか(使わない科目は推定・選択に出さない。03 の 0.2 手順5、04 CH-14)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  constraint account_titles_name_key unique (name)
);

create unique index account_titles_code_key on public.account_titles (code) where code is not null;

create trigger account_titles_set_updated_at
before update on public.account_titles
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.account_titles enable row level security;

-- 初期データ【仮】一般的な科目(00_仮決め一覧 E-07-仮-13)。すみたや様・税理士の使っている科目に合わせて SQL で直す
insert into public.account_titles (name, description, sort_order) values
  ('旅費交通費', '電車・バス・タクシーの運賃、出張の宿泊費、駐車場代、高速道路の料金', 10),
  ('通信費', '切手・はがき・電話代・インターネットの料金', 20),
  ('消耗品費', '10万円未満の備品・道具・掃除用品・作業用品（ガムテープ・軍手など）', 30),
  ('事務用品費', '文房具・コピー用紙・インク・ファイルなどの事務用品', 40),
  ('会議費', '打ち合わせの飲み物・軽食・会議室の料金', 50),
  ('交際費', '取引先・町内会などへの接待の飲食、贈答品、お祝い・お見舞い', 60),
  ('荷造運賃', '商品を送る送料・宅配便・梱包の材料', 70),
  ('広告宣伝費', 'チラシ・ポスター・広告の掲載料・のぼりなどの宣伝の品', 80),
  ('新聞図書費', '新聞・雑誌・本・業界の資料', 90),
  ('支払手数料', '振込手数料・各種の手数料', 100),
  ('車両費', '社用車のガソリン代・洗車・車の点検・修理', 110),
  ('修繕費', '店舗・工場・機械の修理・補修の費用', 120),
  ('福利厚生費', '従業員のための飲み物・お茶菓子・健康診断・慶弔', 130),
  ('租税公課', '収入印紙・各種の証明書の手数料・税金', 140),
  ('雑費', 'ほかの科目にあてはまらない少額の費用', 150);
