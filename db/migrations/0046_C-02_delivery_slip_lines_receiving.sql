-- 0046 C-02 納品書の明細(delivery_slip_lines)の照合・検収の列に、発注の明細への外部キーと、照合の結果の CHECK を足す
-- 設計書: C-02 01 5.2・6.1、04 CH-03〜CH-05・CH-09、00_仮決め一覧 C-01-仮-20
-- 0045 の後に1回だけ実行する(0039 の purchase_order_lines と 0043 の delivery_slip_lines を参照する)。
-- movement_id(在庫の記録 inventory_movements.id)の外部キーは付けない。B-03 の在庫の記録がまだ無いため、
-- C-02 は在庫の記録を作らず movement_id は空のままにする(00_仮決め一覧 C-02-仮-11)。B-03 を作るときに付ける。

alter table public.delivery_slip_lines
  add constraint delivery_slip_lines_purchase_order_line_id_fkey
    foreign key (purchase_order_line_id) references public.purchase_order_lines (id);

create index delivery_slip_lines_purchase_order_line_id_idx on public.delivery_slip_lines (purchase_order_line_id);

-- 照合の結果(01 5.2): matched 一致 / partial 分納 / over 多い / price_diff 単価が違う / no_order_line 発注に無い /
-- negative マイナス / non_stock 在庫にしない品。0043 で付けた長さだけの CHECK(自動の名前)を外して置き換える
alter table public.delivery_slip_lines
  drop constraint if exists delivery_slip_lines_match_result_check;
alter table public.delivery_slip_lines
  add constraint delivery_slip_lines_match_result_check
    check (match_result in ('matched', 'partial', 'over', 'price_diff', 'no_order_line', 'negative', 'non_stock'));

-- 検収で受け入れた数は0以上の整数(CH-09)
alter table public.delivery_slip_lines
  add constraint delivery_slip_lines_accepted_quantity_check check (accepted_quantity >= 0);
