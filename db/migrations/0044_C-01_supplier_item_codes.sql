-- 0044 C-01 仕入先の品番と自社の商品の対応表(supplier_item_codes)
-- 設計書: C-01 01 9.3(列)、03 EV-06 手順9・EV-10 手順6・EV-12、04 CH-13、00_共通設計 3.6
-- 0043 の後に1回だけ実行する(suppliers・products・employees を参照する)。
-- 担当は C-01。C-02 が入数(pack_quantity)を読む。まとめて取り込む仕組みは作らない(G04 で1件ずつ。C-01 01 0.3)。

create table public.supplier_item_codes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  -- 仕入先の品番(前後の空白を取り、全角英数字を半角に、大文字にそろえて持つ。CH-06・CH-13)
  supplier_item_code text not null check (char_length(supplier_item_code) between 1 and 50),
  -- 仕入先の品名(参考)
  supplier_item_name text check (char_length(supplier_item_name) <= 100),
  product_id uuid not null references public.products (id),
  -- 入数(伝票の1単位が自社の何個か。1箱＝10枚なら10。CH-13: 1〜9,999)
  pack_quantity integer not null default 1 check (pack_quantity between 1 and 9999),
  -- 使っているか
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),
  constraint supplier_item_codes_supplier_code_key unique (supplier_id, supplier_item_code)
);

create index supplier_item_codes_product_id_idx on public.supplier_item_codes (product_id);

create trigger supplier_item_codes_set_updated_at
before update on public.supplier_item_codes
for each row execute function public.set_updated_at();

alter table public.supplier_item_codes enable row level security;
