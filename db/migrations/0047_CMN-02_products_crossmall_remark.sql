-- 0047 CMN-02 商品(products)に、CROSS MALL の商品備考の写し(crossmall_remark)を足す
-- 設計書: CMN-02 01 の 11章(11.1・11.3)、B-02 04 の 0.5 追記(CH-16)、00_仮決め一覧 B-02-仮-19
-- 0046 の後に1回だけ実行する。
-- 商品備考が「s_」で始まる商品は、物流倉庫(スクロール360)に置いている商品(すみたや様の提出資料の説明)。
-- 社員が書く「メモ」(note)とは別の列にする(取り込みでメモを上書きしないため)。

alter table public.products
  add column crossmall_remark text check (char_length(crossmall_remark) <= 500);

comment on column public.products.crossmall_remark is
  'CROSS MALL の商品備考の写し(在庫CSVの取り込みで書く)。s_ で始まればスクロール360の商品';
