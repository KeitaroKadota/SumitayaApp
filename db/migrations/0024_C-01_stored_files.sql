-- 0024 C-01 画像・PDFの記録(stored_files)
-- 設計書: C-01 01 8.1・8.2(列)・8.3、03 EV-02・EV-02B・EV-03、04 CH-01〜CH-03、00_共通設計 3.1・7.2
-- 0023 の後に1回だけ実行する(employees を参照する)。received_invoices(0025)より先に入れる。
-- 担当は C-01。使う側(E-04 の received_invoices.file_id、C-01 の delivery_slips.file_ids、E-07 など)が stored_files.id を持つ。
-- ここでは用途だけを持ち、相手のIDは持たない。実物は Supabase Storage のバケット sumitaya-files(非公開)に置く。
-- 削除は論理削除(deleted_at)。置き場の実物は論理削除から30日後に手で消す(00_仮決め一覧 C-01-仮-08)。

create table public.stored_files (
  -- 置き場のパスに使うため、アプリで先に決めて入れる
  id uuid primary key default gen_random_uuid(),
  -- 置き場(バケット)の名前
  bucket text not null default 'sumitaya-files' check (bucket ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  -- 置き場の中のパス(<用途>/<年>/<月>/<id>.<拡張子>。元のファイル名は使わない)
  path text not null check (path ~ '^[a-z_]+/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  -- 用途: delivery_slip(C-01)・received_invoice(E-04)・receipt(E-07)・other
  purpose text not null check (purpose in ('delivery_slip', 'received_invoice', 'receipt', 'other')),
  -- 元のファイル名(画面に出すだけ)
  original_name text not null check (char_length(original_name) between 1 and 255),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  -- 大きさ(画像は4MB・PDFは10MBまで。アプリで確かめる。ここは置き場の上限の10MB)
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  -- 中身の指紋(SHA-256。同じファイルを2回上げたことに気づくため。CH-03)
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- 論理削除
  deleted_at timestamptz,
  deleted_by uuid references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  constraint stored_files_path_key unique (bucket, path)
);

-- CH-03 同じ指紋・同じ用途の、消していないファイルを探す
create index stored_files_sha256_idx on public.stored_files (sha256, purpose) where deleted_at is null;

create trigger stored_files_set_updated_at
before update on public.stored_files
for each row execute function public.set_updated_at();

-- RLS を有効にする。ポリシーは作らない(アプリはサーバーからだけ接続する。00_共通設計 1章)
alter table public.stored_files enable row level security;
