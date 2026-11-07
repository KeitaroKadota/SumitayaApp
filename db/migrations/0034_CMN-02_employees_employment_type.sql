-- 0034 CMN-02 従業員(employees): 雇用形態を「正社員・パート(常時)・パート(臨時)」にする
-- 設計書: CMN-02 01 6.1、04 CH-05、00_共通設計 3.1(版0.4。ヒアリング No.28)
-- 0033 の後に1回だけ実行する。従業員の実データはここに書かない。

begin;

-- 0002 で列に付けた名前なしの CHECK を外す
alter table public.employees drop constraint employees_employment_type_check;

-- 今ある行を新しい値に移す。パート → パート(常時)。
-- 【仮】「その他」は設計書に移し先が無いため、パート(臨時)にする(確認したら直す)
update public.employees set employment_type = 'part_time_regular' where employment_type = 'part_time';
update public.employees set employment_type = 'part_time_temporary' where employment_type = 'other';

alter table public.employees
  add constraint employees_employment_type_check
  check (employment_type in ('full_time', 'part_time_regular', 'part_time_temporary'));

commit;
