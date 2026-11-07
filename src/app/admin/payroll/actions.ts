"use server";

// 給与CSVの操作(E-03 03 の EV-03 締める前のチェック・EV-04 締めの確定・EV-06 締めの解除)。機能キー payroll(社長だけ。No.46)。
// 結果は戻り値(FormState)で返し、できたら G01 へ移す(Next.js の説明書 01-getting-started/10-error-handling.md)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { checkAttendancePeriod } from "@/utils/attendanceCron";
import { transaction } from "@/utils/db";
import { formValues, type FormState } from "@/utils/formState";
import { todayJST } from "@/utils/jst";
import { payrollPeriodOfMonth, shiftPayrollPeriod, type PayrollPeriod } from "@/utils/payrollPeriod";
import { CLOSE_NOTE_MAX, REOPEN_REASON_MAX } from "@/utils/payrollRules";
import {
  countOpenAlertsBySeverity,
  getPayrollExport,
  hasAttendanceIn,
  loadPayrollMasters,
  loadPayrollSummary,
  savePayrollClose,
  savePayrollReopen,
} from "@/utils/payrollServer";
import { buildSnapshot, snapshotHash } from "@/utils/payrollSummary";
import { formText } from "@/utils/textNormalize";
import { isSelectableMonth, payrollUrl, periodLabel, periodNotEndedMessage } from "./payrollView";

const BAD_PERIOD = "対象の期間が正しくありません。画面を開き直してください。";

// 確定の途中でやめるとき(トランザクションを戻す)
class InputError extends Error {}

// CH-01・CH-02・CH-05 締められる期間か。だめなら理由の文
const closeBlocker = async (month: string, today: string): Promise<string | null> => {
  const period = payrollPeriodOfMonth(month);
  const notEnded = periodNotEndedMessage(period, today);
  if (notEnded) return notEnded;
  const row = await getPayrollExport(period.from);
  if (row?.status === "closed") return "この期間はすでに締め済みです。";
  // CH-05 前の期間に打刻・シフトがあれば、前の期間が締め済みであること(使い始めの期間は問わない)
  const prev = shiftPayrollPeriod(period, -1);
  if (await hasAttendanceIn(prev)) {
    const prevRow = await getPayrollExport(prev.from);
    if (prevRow?.status !== "closed") return `先に ${periodLabel(prev)} を締めてください。`;
  }
  return null;
};

// ---- EV-03 「締める」を押す(G01 → G02) ----

export async function prepareCloseAction(month: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAccess("payroll", "/admin/payroll");
  const today = todayJST();
  if (!isSelectableMonth(month, today)) return { errors: {}, formError: BAD_PERIOD, values: {} };
  void formData;
  // 手順1
  const blocker = await closeBlocker(month, today);
  if (blocker) return { errors: {}, formError: blocker, values: {} };
  // 手順2 最新の状態にするため、その期間の全員の勤怠をチェックし直す
  try {
    await checkAttendancePeriod(payrollPeriodOfMonth(month), today);
  } catch (e) {
    console.error("締める前の勤怠のチェックができませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "チェックできませんでした。時間をおいてもう一度お試しください。", values: {} };
  }
  // 手順3 G02 を開く(異常の一覧は G02 で読む)
  redirect(payrollUrl(month, "&close=1"));
}

// ---- EV-04 G02 で「締める」を押す(締めの確定) ----

export async function closePayrollAction(month: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("payroll", "/admin/payroll");
  const today = todayJST();
  const values = formValues(formData);
  if (!isSelectableMonth(month, today)) return { errors: {}, formError: BAD_PERIOD, values };
  const period: PayrollPeriod = payrollPeriodOfMonth(month);

  // 手順1 CH-01(画面の期間が今の計算と同じか)・CH-02・CH-05
  if (formText(formData, "period_start") !== period.from) return { errors: {}, formError: BAD_PERIOD, values };
  const blocker = await closeBlocker(month, today);
  if (blocker) return { errors: {}, formError: blocker, values };
  const memo = formText(formData, "note");
  if (memo.length > CLOSE_NOTE_MAX) return { errors: { note: `${CLOSE_NOTE_MAX}文字以内で入力してください。` }, formError: null, values };
  const confirmed = formText(formData, "confirmed") === "1";

  try {
    // トランザクションの中では query を使えないので、従業員・休業日・打刻の場所は先に読む
    const masters = await loadPayrollMasters(period);
    await transaction(async (tx) => {
      // 手順2 行を押さえる(2人が同時に締めないように)
      const row = await getPayrollExport(period.from, { tx, forUpdate: true });
      if (row?.status === "closed") throw new InputError("この期間はすでに締め済みです。");
      // 手順3 CH-03(G02 を開いてから誰かが打刻を変えた場合に備え、もう一度数える)
      const counts = await countOpenAlertsBySeverity(period, tx);
      if (counts.fix > 0) throw new InputError(`要修正の異常が ${counts.fix}件 あります。直してから締めてください。`);
      // 手順4 CH-04
      const review = counts.legal + counts.info;
      if (review > 0 && !confirmed) throw new InputError("内容を確認して、印を付けてください。");
      // 手順5 集計を作り、snapshot とハッシュを作る
      const summary = await loadPayrollSummary(period, today, masters, tx);
      const snapshot = buildSnapshot(period, summary.rows, summary.openAlerts);
      const hash = snapshotHash(snapshot);
      // 手順6 メモ＋確認した件数
      const note = [memo, review > 0 ? `法令・確認の未対応 ${review}件を確認して締めた` : ""].filter(Boolean).join("／") || null;
      await savePayrollClose(tx, { period, existing: row !== null, note, snapshot, hash, by: me.id });
    });
  } catch (e) {
    if (e instanceof InputError) return { errors: {}, formError: e.message, values };
    console.error("給与の締めを保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "締められませんでした。時間をおいてもう一度お試しください。", values };
  }

  // 手順7(締め済みの月は E-02 の画面でも直せなくなる)
  revalidatePath("/admin/payroll");
  revalidatePath("/admin/attendance", "layout");
  redirect(payrollUrl(month, "&done=closed"));
}

// ---- EV-06 「解除する」を押す(G03) ----

export async function reopenPayrollAction(month: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("payroll", "/admin/payroll");
  const today = todayJST();
  const values = formValues(formData);
  if (!isSelectableMonth(month, today)) return { errors: {}, formError: BAD_PERIOD, values };
  const period = payrollPeriodOfMonth(month);
  const next = shiftPayrollPeriod(period, 1);

  // 手順2 CH-07 理由
  const reason = formText(formData, "reason");
  if (!reason) return { errors: { reason: "理由を入力してください。" }, formError: null, values };
  if (reason.length > REOPEN_REASON_MAX) {
    return { errors: { reason: `${REOPEN_REASON_MAX}文字以内で入力してください。` }, formError: null, values };
  }

  try {
    await transaction(async (tx) => {
      // 手順3 行を押さえて、CH-07 の状態・次の期間を確かめてから解除する
      const row = await getPayrollExport(period.from, { tx, forUpdate: true });
      if (row?.status !== "closed") throw new InputError("この期間は締め済みではありません。");
      const nextRow = await getPayrollExport(next.from, { tx });
      if (nextRow?.status === "closed") throw new InputError(`先に ${periodLabel(next)} の締めを解除してください。`);
      await savePayrollReopen(tx, period.from, reason, me.id);
    });
  } catch (e) {
    if (e instanceof InputError) return { errors: {}, formError: e.message, values };
    console.error("給与の締めを解除できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "解除できませんでした。", values };
  }

  // 手順4(解除のあとは、毎朝7:00のチェックからその期間がまた対象になる)
  revalidatePath("/admin/payroll");
  revalidatePath("/admin/attendance", "layout");
  redirect(payrollUrl(month, "&done=reopened"));
}
