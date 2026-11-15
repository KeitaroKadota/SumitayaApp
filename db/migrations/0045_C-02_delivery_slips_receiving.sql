-- 0045 C-02 納品書(delivery_slips)の照合・検収の列に、発注への外部キーと索引を足す
-- 設計書: C-02 01 6.1・6.3・8章、03 EV-01・EV-03・EV-09、04 CH-07・CH-08、00_仮決め一覧 C-01-仮-20
-- 0044 の後に1回だけ実行する(0039 の purchase_orders と 0043 の delivery_slips を参照する)。
-- 列そのものは C-01 の 0043 で作ってある(C-02 01 6.1)。ここでは C-01 が付けずにおいた外部キーと、G01 の索引だけを足す。

-- 結び付けた発注(5.1)。発注の行は下書きのときだけ消せる(A-03)ので、消すときの扱いは既定(消させない)のままにする
alter table public.delivery_slips
  add constraint delivery_slips_purchase_order_id_fkey foreign key (purchase_order_id) references public.purchase_orders (id);

create index delivery_slips_purchase_order_id_idx on public.delivery_slips (purchase_order_id);
-- G01 の「今月の検収」の件数(状態と検収した日時で数える。EV-09 手順3)
create index delivery_slips_status_accepted_at_idx on public.delivery_slips (status, accepted_at);
