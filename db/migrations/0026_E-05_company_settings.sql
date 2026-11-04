-- 0026 E-05 自社の情報(company_settings)。請求書(E-05)と発注書(A-03)に載せる、会社名・登録番号・振込先など
-- 設計書: E-05 01 6.3(列)、03 の 0.3・0.4、04 CH-02・CH-07、00_共通設計 3.3
-- 0025 の後に1回だけ実行する。
-- 1行だけのテーブル(id = 1)。編集する画面は作らない。値は開発者が SQL(または Supabase の管理画面)で入れる。
-- 値(登録番号・口座など)はすみたや様の実データなので、このファイル(リポジトリ)には書かない。入れ方の例は README。

create table public.company_settings (
  -- 1行だけにする
  id smallint primary key default 1 check (id = 1),
  -- 会社名(空のあいだは請求書を発行できない。CH-02)
  company_name text not null default '' check (char_length(company_name) <= 100),
  postal_code text check (char_length(postal_code) <= 10),
  address text check (char_length(address) <= 200),
  tel text check (char_length(tel) <= 20),
  -- FAX・メールは A-03 の発注書で使う
  fax text check (char_length(fax) <= 20),
  email text check (char_length(email) <= 254),
  -- 適格請求書発行事業者の登録番号(T＋数字13けた)。空のあいだは請求書を発行できない(CH-02)。
  -- 形(CH-03)は発行のときに確かめる(全角・空白・ハイフンは取り除いてから比べる)
  registration_no text check (char_length(registration_no) <= 30),
  -- 振込先(銀行名・支店名・種別・口座番号・名義のカナ)。空なら請求書に振込先の欄を出さない
  bank_name text check (char_length(bank_name) <= 50),
  bank_branch text check (char_length(bank_branch) <= 50),
  bank_account_type text check (bank_account_type in ('普通', '当座')),
  bank_account_no text check (char_length(bank_account_no) <= 20),
  bank_account_holder text check (char_length(bank_account_holder) <= 100),
  -- 消費税の端数処理(floor: 切り捨て / round: 四捨五入 / ceil: 切り上げ)。【仮】切り捨て(00_仮決め一覧 E-05-仮-01)
  rounding text not null default 'floor' check (rounding in ('floor', 'round', 'ceil')),
  updated_at timestamptz not null default now()
);

create trigger company_settings_set_updated_at
before update on public.company_settings
for each row execute function public.set_updated_at();

alter table public.company_settings enable row level security;
