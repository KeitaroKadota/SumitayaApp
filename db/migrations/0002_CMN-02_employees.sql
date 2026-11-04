-- 0002 CMN-02 従業員(employees)
-- 設計書: CMN-02 01 6.1(列)、CMN-01 01 6章(ログイン関係の列)・04 CH-04・CH-13、00_共通設計 1章
-- 0001 の後に1回だけ実行する。従業員の実データ(名前など)はここに書かない。

-- 商品名の部分一致の検索に使う拡張機能(CMN-02 01 7章。products の索引で使う)
create extension if not exists pg_trgm with schema extensions;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  -- 社員番号(退職者を含めて重複不可)
  employee_code text not null unique,
  last_name text not null,
  first_name text not null,
  last_name_kana text,
  first_name_kana text,
  -- 所属(店舗・工場・事務)
  department text not null check (department in ('store', 'factory', 'office')),
  -- 【仮】雇用形態の値はヒアリング No.28 の回答で直す
  employment_type text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'other')),
  -- 初期パスワード・再設定リンクの送り先(CMN-01)
  email text,
  hired_on date,
  retired_on date check (retired_on >= hired_on),
  -- 勤怠(打刻)の対象か
  uses_timecard boolean not null default true,
  -- 主な勤務場所(E-01 の work_locations)
  home_location_id uuid references public.work_locations (id),
  note text,

  -- ログイン関係(CMN-01 01 6章)
  -- ログインID。小文字で保存する(CH-04: 半角の英字・数字・「-」「_」「.」の3〜20文字)
  login_id text check (login_id ~ '^[a-z0-9._-]{3,20}$'),
  -- パスワードを暗号化したもの(scrypt。salt:hash の形)
  password_hash text,
  -- 権限の区分(CH-13: 決まった値で1つ以上)
  roles text[] not null check (
    cardinality(roles) >= 1 and roles <@ array['president', 'store', 'factory', 'accounting']::text[]
  ),
  must_change_password boolean not null default true,
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz,
  last_login_at timestamptz,

  -- LINE(CMN-03 が書く)
  line_user_id text,
  line_display_name text,
  line_linked_at timestamptz,

  -- 在籍中か。false はログインできない(CMN-01 CH-10)。削除はせず、退職は false と retired_on で表す
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

-- ログインIDは大文字・小文字を区別せずに重複不可(退職者を含む)
create unique index employees_login_id_key on public.employees (lower(login_id));
create unique index employees_line_user_id_key on public.employees (line_user_id) where line_user_id is not null;

create trigger employees_set_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

alter table public.employees enable row level security;

-- 0001 で後回しにした、打刻の場所の作成・更新した人の参照
alter table public.work_locations
  add constraint work_locations_created_by_fkey foreign key (created_by) references public.employees (id),
  add constraint work_locations_updated_by_fkey foreign key (updated_by) references public.employees (id);
