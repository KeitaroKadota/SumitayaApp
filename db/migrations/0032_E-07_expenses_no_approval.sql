-- 0032 E-07 経費(expenses): 承認の段階をなくし、登録したら確定にする
-- 設計書: E-07 01 4.1(状態)・6.1(列)、03 EV-08、04 CH-04、00_共通設計 2章・3.3(版0.4。No.33・2026-11-08 角田さん決定)
-- 0031 の後に1回だけ実行する。途中で止まったときに半端な形で残らないよう、1つのトランザクションで行う。
-- 状態は draft(下書き)・confirmed(登録済み)の2つ。承認・差し戻しの列を消し、submitted_at を confirmed_at に改名する。

begin;

-- 1. 古い状態の CHECK を外す(0031 で列に付けた名前なしの CHECK と、名前を付けた申請の必須の CHECK)。
--    承認・差し戻しの CHECK(名前なし。approved_at・return_reason を使う)は、手順4で列を消すと一緒に消える
alter table public.expenses drop constraint expenses_status_check;
alter table public.expenses drop constraint expenses_submitted_fields_check;

-- 2. 今ある行を新しい状態に移す。
--    承認待ち・承認済みで勘定科目があるもの → 登録済み(登録した日時は申請した日時。無ければ承認した日時・更新日時)
--    勘定科目が無い承認待ち・承認済み(登録済みでは勘定科目が必須。CH-04)と、差し戻し・取り下げ → 下書き(申請した日時は消す)
update public.expenses
set status = 'confirmed', submitted_at = coalesce(submitted_at, approved_at, updated_at)
where status in ('submitted', 'approved') and account_title_id is not null;

update public.expenses
set status = 'draft', submitted_at = null
where status in ('submitted', 'approved', 'returned', 'withdrawn');

-- 3. 残っている承認・差し戻しのタスク(CMN-03 の種類の表から外した)を取消にする。記録は残す
update public.tasks
set status = 'cancelled', completed_at = now(), completion_note = 'E-07 の承認の段階をなくしたため取り消した'
where task_type in ('expense_approve', 'expense_returned') and status = 'open';

-- 4. 承認・差し戻しの列を消す
alter table public.expenses
  drop column approved_by,
  drop column approved_at,
  drop column approve_note,
  drop column returned_by,
  drop column returned_at,
  drop column return_reason;

-- 5. 申請した日時 → 登録(確定)した日時
alter table public.expenses rename column submitted_at to confirmed_at;

-- 6. 新しい CHECK。登録済みは、支払った日・支払先・合計(1円以上)・勘定科目・登録した日時が入っている(CH-04)
alter table public.expenses
  add constraint expenses_status_check check (status in ('draft', 'confirmed')),
  add constraint expenses_confirmed_fields_check check (
    status = 'draft'
    or (spent_on is not null and payee_name is not null and total >= 1
        and account_title_id is not null and confirmed_at is not null)
  );

commit;
