-- 0033 D-04 特注の案件(custom_quotes): デザインの欄を足す
-- 設計書: D-04 01 4.1・6.1、03 の 0.1、04 CH-02(版0.4。No.24 の必ず聞く5項目「希望の商品・デザイン・数量・サイズ・納期」)
-- 0032 の後に1回だけ実行する。

begin;

-- デザインの希望(色柄・紋・文字など。1,000文字まで)
alter table public.custom_quotes
  add column design_note text,
  add constraint custom_quotes_design_note_check check (char_length(design_note) <= 1000);

-- 足りない項目(missing_items)を新しい5項目で計算し直す(src/utils/customQuote.ts の findMissingItems と同じ決まり)。
-- 生地・名入れは聞き返しの項目から外した(概算のときに確かめる)
update public.custom_quotes
set missing_items = array_remove(array[
  case when item_type is null then '希望の商品' end,
  case when design_note is null then 'デザイン' end,
  case when quantity is null or quantity = 0 then '数量' end,
  case when size_breakdown is null or size_breakdown = '[]'::jsonb then 'サイズ' end,
  case when desired_date is null then '納期' end
], null);

commit;
