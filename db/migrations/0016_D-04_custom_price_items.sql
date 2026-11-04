-- 0016 D-04 特注の概算の単価表(custom_price_items)
-- 設計書: D-04 01 4.2・6.2(列)、03 EV-13、04 CH-13・CH-14、00_共通設計 3.2
-- 0015 の後に1回だけ実行する(employees を参照する)。
-- 単価の値はここに書かない(すみたや様の概算テンプレート・生地の単価表〔ヒアリング No.22〕が未提出のため。
-- 動きを確かめる仮の単価は、画面〔/admin/inquiries/price-items〕で登録する。00_仮決め一覧 D-04-仮-02)。

create table public.custom_price_items (
  id uuid primary key default gen_random_uuid(),
  -- 区分(縫製〔品目と縫製代〕・生地・名入れの方法・版代など1回だけの代金)
  kind text not null check (kind in ('sewing', 'fabric', 'print', 'setup')),
  -- 対象の品目(sewing の行では品目そのもの。ほかの行では空＝どの品目にも使える)
  item_type text check (char_length(item_type) between 1 and 100),
  name text not null check (char_length(name) between 1 and 100),
  -- 1枚あたり・1回あたり(CH-13 版代は1回あたりだけ)
  unit text not null check (unit in ('per_piece', 'per_order')),
  -- 単価(税抜・円)
  unit_price integer not null check (unit_price between 0 and 9999999),
  -- この単価を使う枚数の範囲(qty_to が空＝上限なし)
  qty_from integer not null default 1 check (qty_from >= 1),
  qty_to integer,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  -- 使う／使わない(消さない)
  is_active boolean not null default true,
  -- メモ(お客様には出さない)
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id),

  constraint custom_price_items_qty_range_check check (qty_to is null or qty_to >= qty_from),
  constraint custom_price_items_sewing_item_type_check check (kind <> 'sewing' or item_type is not null),
  constraint custom_price_items_setup_unit_check check (kind <> 'setup' or unit = 'per_order')
);

-- CH-14(同じ区分・品目・名前の使う行どうしで枚数の範囲が重ならない)は画面の保存で確かめる
create index custom_price_items_kind_item_type_idx on public.custom_price_items (kind, item_type, sort_order, qty_from);

create trigger custom_price_items_set_updated_at
before update on public.custom_price_items
for each row execute function public.set_updated_at();

alter table public.custom_price_items enable row level security;
