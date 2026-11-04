"use server";

// 勤怠の管理画面の操作(E-02 03 の EV-03〜EV-05・EV-07〜EV-09)。機能キー attendance_admin(社長・経理)。
// 保存のあと、その人の、その日を含む週と給与期間をチェックし直す(03 の 0.3)。チェックに失敗しても保存は取り消さない。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import {
  hhmmToMinutes,
  punchSequenceError,
  requiredBreakMinutes,
  type ShiftKind,
} from "@/utils/attendance";
import { recheckAttendance } from "@/utils/attendanceCron";
import {
  bulkUpsertShifts,
  deleteShift,
  dismissAlert,
  getAlert,
  insertManualPunch,
  listAttendanceEmployees,
  upsertShift,
  voidPunch,
  type ShiftInput,
} from "@/utils/attendanceServer";
import { transaction } from "@/utils/db";
import { formValues, type FormState } from "@/utils/formState";
import { addDays, getCalendar } from "@/utils/holidays";
import { combineDateTimeJST, isValidHHmm, weekdayOfDateStr } from "@/utils/jst";
import { isPayrollClosed, payrollPeriodOf } from "@/utils/payrollPeriod";
import { completeTasksBySource } from "@/utils/tasks";
import { formText, isValidDateStr } from "@/utils/textNormalize";
import { isPunchKind, PUNCH_KIND_LABELS } from "@/utils/timecard";
import { listActiveLocations, listPunches, lockEmployee } from "@/utils/timecardServer";
import { attendanceUrl, isUuid, shiftsUrl } from "./attendanceView";

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CLOSED = "この期間は締め済みです。";
const REASON_MAX = 200;
const NOTE_MAX = 200;
// CH-11 まとめて入力の期間の上限(日)
const BULK_MAX_DAYS = 62;

// 並びの決まりなどで保存をやめるとき(トランザクションを戻す)
class InputError extends Error {
  constructor(
    message: string,
    readonly field: string | null = null
  ) {
    super(message);
  }
}

const reasonError = (reason: string, empty: string): string | null =>
  !reason ? empty : reason.length > REASON_MAX ? `${REASON_MAX}文字以内で入力してください。` : null;

// 対象の従業員(勤怠の対象で、表の期間に出る人)
const findEmployee = async (employeeId: string, date: string) => {
  if (!isUuid(employeeId) || !isValidDateStr(date)) return null;
  const period = payrollPeriodOf(date);
  const [employee] = await listAttendanceEmployees(period.from, period.to, [employeeId]);
  return employee ?? null;
};

// 保存のあとのチェック。失敗したら false
const recheck = async (employeeIds: string[], dates: string[]): Promise<boolean> => {
  try {
    await recheckAttendance(employeeIds, dates);
    return true;
  } catch (e) {
    console.error("勤怠のチェックをし直せませんでした:", e instanceof Error ? e.message : e);
    return false;
  }
};

const editUrl = (employeeId: string, date: string, done: string) =>
  attendanceUrl(payrollPeriodOf(date).month, `&edit=${employeeId}:${date}&done=${done}`);

// ---- EV-03 打刻の追加 ----

export async function addPunchAction(employeeId: string, workDate: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("attendance_admin", attendanceUrl(payrollPeriodOf(workDate).month));
  const values = formValues(formData);
  const employee = await findEmployee(employeeId, workDate);
  if (!employee) return { errors: {}, formError: "従業員または日付が正しくありません。", values };

  // 手順1 CH-10
  if (await isPayrollClosed(workDate)) return { errors: {}, formError: CLOSED, values };

  // 手順2 CH-09
  const kind = formText(formData, "kind");
  const date = formText(formData, "date");
  const time = formText(formData, "time");
  const reason = formText(formData, "reason");
  const replace = formText(formData, "replace") === "1";
  const errors: Record<string, string> = {};
  if (!isPunchKind(kind)) errors.kind = "種類を選んでください。";
  if (date !== workDate && date !== addDays(workDate, 1)) errors.date = "日付は勤務日の当日か翌日にしてください。";
  if (!isValidHHmm(time)) errors.time = "時刻を「09:30」の形で入力してください。";
  const reasonMessage = reasonError(reason, "理由を入力してください。");
  if (reasonMessage) errors.reason = reasonMessage;
  if (Object.keys(errors).length > 0 || !isPunchKind(kind)) return { errors, formError: null, values };
  const punchedAt = combineDateTimeJST(date, time);
  if (punchedAt.getTime() > Date.now()) return { errors: { time: "まだ来ていない時刻です。" }, formError: null, values };

  try {
    // 手順3〜7
    await transaction(async (tx) => {
      await lockEmployee(tx, employeeId);
      const punches = await listPunches(employeeId, workDate, workDate, { tx });
      let current = punches;
      // 手順4 置き換える: 同じ種類の有効な打刻のうち、入力の時刻にいちばん近いものを取り消す
      if (replace) {
        const same = punches.filter((p) => p.kind === kind);
        if (same.length === 0) throw new InputError(`置き換える${PUNCH_KIND_LABELS[kind]}の打刻がありません。`, "replace");
        const nearest = same.reduce((a, b) =>
          Math.abs(b.punchedAt.getTime() - punchedAt.getTime()) < Math.abs(a.punchedAt.getTime() - punchedAt.getTime()) ? b : a
        );
        await voidPunch(tx, { punchId: nearest.id, employeeId, workDate, reason, by: me.id });
        current = punches.filter((p) => p.id !== nearest.id);
      }
      // CH-09 同じ種類・同じ時刻(分)
      const minute = Math.floor(punchedAt.getTime() / 60000);
      if (current.some((p) => p.kind === kind && Math.floor(p.punchedAt.getTime() / 60000) === minute)) {
        throw new InputError("同じ打刻がすでにあります。", "time");
      }
      // 手順6 追加・取り消しのあとの並び
      const sequenceError = punchSequenceError([
        ...current,
        {
          id: "new",
          kind,
          punchedAt,
          workDate,
          source: "manual",
          locationId: null,
          locationStatus: "not_checked",
          distanceM: null,
          accuracyM: null,
          note: reason,
          voidedAt: null,
          voidReason: null,
        },
      ]);
      if (sequenceError) throw new InputError(sequenceError);
      // 手順5
      await insertManualPunch(tx, { employeeId, kind, punchedAt, workDate, reason, by: me.id });
    });
  } catch (e) {
    if (e instanceof InputError) {
      return e.field ? { errors: { [e.field]: e.message }, formError: null, values } : { errors: {}, formError: e.message, values };
    }
    console.error("打刻を追加できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  // 手順8・9
  const checked = await recheck([employeeId], [workDate]);
  revalidatePath("/admin/attendance");
  redirect(editUrl(employeeId, workDate, checked ? "added" : "added_nocheck"));
}

// ---- EV-04 打刻の取り消し ----

export async function voidPunchAction(
  employeeId: string,
  workDate: string,
  punchId: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const me = await requireAccess("attendance_admin", attendanceUrl(payrollPeriodOf(workDate).month));
  const values = formValues(formData);
  const employee = await findEmployee(employeeId, workDate);
  if (!employee || !isUuid(punchId)) return { errors: {}, formError: "この打刻はすでに取り消されています。", values };
  // 手順1 CH-10
  if (await isPayrollClosed(workDate)) return { errors: {}, formError: CLOSED, values };
  // 手順2
  const reason = formText(formData, "reason");
  const reasonMessage = reasonError(reason, "取り消しの理由を入力してください。");
  if (reasonMessage) return { errors: { reason: reasonMessage }, formError: null, values };

  try {
    // 手順3・5
    const done = await transaction(async (tx) => {
      await lockEmployee(tx, employeeId);
      return await voidPunch(tx, { punchId, employeeId, workDate, reason, by: me.id });
    });
    if (!done) return { errors: {}, formError: "この打刻はすでに取り消されています。", values };
  } catch (e) {
    console.error("打刻を取り消せませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "保存できませんでした。", values };
  }

  // 手順6
  const checked = await recheck([employeeId], [workDate]);
  revalidatePath("/admin/attendance");
  redirect(editUrl(employeeId, workDate, checked ? "voided" : "voided_nocheck"));
}

// ---- EV-05 確認済みにする ----

export async function dismissAlertAction(alertId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("attendance_admin", "/admin/attendance");
  const values = formValues(formData);
  const alert = isUuid(alertId) ? await getAlert(alertId) : null;
  // 手順1 CH-13
  if (!alert || alert.status !== "open" || alert.severity === "fix") {
    return { errors: {}, formError: "打刻漏れは、打刻を直すと自動で解決します。", values };
  }
  // CH-10
  if (await isPayrollClosed(alert.workDate)) return { errors: {}, formError: CLOSED, values };
  // 手順2
  const note = formText(formData, "note");
  const noteMessage = reasonError(note, "理由を入力してください。");
  if (noteMessage) return { errors: { note: noteMessage }, formError: null, values };

  // 手順3
  try {
    if (!(await dismissAlert(alert.id, note, me.id))) {
      return { errors: {}, formError: "この異常はすでに対応済みです。", values };
    }
  } catch (e) {
    console.error("異常を確認済みにできませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  // 手順4 失敗しても保存は取り消さない
  try {
    await completeTasksBySource("E-02", alert.id);
  } catch (e) {
    console.error("勤怠の異常のタスクを完了にできませんでした:", e instanceof Error ? e.message : e);
  }

  revalidatePath("/admin/attendance");
  redirect(editUrl(alert.employeeId, alert.workDate, "dismissed"));
}

// ---- EV-07〜EV-09 シフト ----

const SHIFT_KINDS: readonly ShiftKind[] = ["work", "paid_leave", "paid_leave_half", "special_leave", "absence"];
const isShiftKind = (v: string): v is ShiftKind => (SHIFT_KINDS as readonly string[]).includes(v);
const hasTimes = (kind: ShiftKind) => kind === "work" || kind === "paid_leave_half";

// CH-11 区分・時刻・休憩・場所・メモ。よければ入力の値と、休憩の注意(あれば)を返す
const validateShiftInput = async (
  formData: FormData,
  errors: Record<string, string>
): Promise<{ input: ShiftInput; warning: string | null } | null> => {
  const kind = formText(formData, "kind");
  if (!isShiftKind(kind)) {
    errors.kind = "区分を選んでください。";
    return null;
  }
  const note = formText(formData, "note");
  if (note.length > NOTE_MAX) errors.note = `メモは${NOTE_MAX}文字以内で入力してください。`;
  if (!hasTimes(kind)) {
    // 休みの区分は時刻・休憩・場所を持たない
    return Object.keys(errors).length > 0
      ? null
      : { input: { kind, startTime: null, endTime: null, breakMinutes: 0, locationId: null, note: note || null }, warning: null };
  }
  const start = formText(formData, "start_time");
  const end = formText(formData, "end_time");
  const breakText = formText(formData, "break_minutes") || "0";
  const locationId = formText(formData, "location_id");
  if (!isValidHHmm(start)) errors.start_time = "開始を「09:30」の形で入力してください。";
  if (!isValidHHmm(end)) errors.end_time = "終了を「18:30」の形で入力してください。";
  else if (isValidHHmm(start) && hhmmToMinutes(end) <= hhmmToMinutes(start)) {
    errors.end_time = "終了は開始より後にしてください（夜12時をまたぐシフトは登録できません）。";
  }
  const breakMinutes = /^\d{1,4}$/.test(breakText) ? Number(breakText) : NaN;
  const span = isValidHHmm(start) && isValidHHmm(end) ? hhmmToMinutes(end) - hhmmToMinutes(start) : null;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || (span !== null && span > 0 && breakMinutes >= span)) {
    errors.break_minutes = "休憩は0以上、開始から終了までより短い分で入力してください。";
  }
  if (locationId) {
    const locations = await listActiveLocations();
    if (!locations.some((l) => l.id === locationId)) errors.location_id = "場所を選び直してください。";
  }
  if (Object.keys(errors).length > 0 || span === null) return null;
  // 予定の休憩が足りない(保存はしてよい。CH-11)
  const worked = span - breakMinutes;
  const required = requiredBreakMinutes(worked);
  const warning = kind === "work" && breakMinutes < required ? `予定の休憩が足りません（必要 ${required}分）。` : null;
  return {
    input: { kind, startTime: start, endTime: end, breakMinutes, locationId: locationId || null, note: note || null },
    warning,
  };
};

// EV-07 1日のシフトを保存する
export async function saveShiftAction(employeeId: string, workDate: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("attendance_admin", shiftsUrl(payrollPeriodOf(workDate).month));
  const values = formValues(formData);
  const employee = await findEmployee(employeeId, workDate);
  // CH-11 従業員は在籍中で勤怠の対象の人
  if (!employee || !employee.isActive) return { errors: {}, formError: "この従業員のシフトは登録できません。", values };
  // 手順1 CH-10
  if (await isPayrollClosed(workDate)) return { errors: {}, formError: CLOSED, values };
  // 手順2 CH-11
  const errors: Record<string, string> = {};
  const result = await validateShiftInput(formData, errors);
  if (!result) return { errors, formError: null, values };

  // 手順4
  try {
    await upsertShift(employeeId, workDate, result.input, me.id);
  } catch (e) {
    console.error("シフトを保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "保存できませんでした。", values };
  }
  // 手順5・6
  await recheck([employeeId], [workDate]);
  revalidatePath("/admin/attendance");
  redirect(shiftsUrl(payrollPeriodOf(workDate).month, `&saved=1${result.warning ? "&warn=break" : ""}`));
}

// EV-08 シフトを削除する(確認のダイアログは画面で出す)
export async function deleteShiftAction(employeeId: string, workDate: string): Promise<void> {
  await requireAccess("attendance_admin", shiftsUrl(payrollPeriodOf(workDate).month));
  const month = payrollPeriodOf(workDate).month;
  if (!isUuid(employeeId) || !isValidDateStr(workDate) || (await isPayrollClosed(workDate))) {
    redirect(shiftsUrl(month, "&saved=closed"));
  }
  try {
    await deleteShift(employeeId, workDate);
  } catch (e) {
    console.error("シフトを削除できませんでした:", e instanceof Error ? e.message : e);
    redirect(shiftsUrl(month, "&saved=failed"));
  }
  await recheck([employeeId], [workDate]);
  revalidatePath("/admin/attendance");
  redirect(shiftsUrl(month, "&saved=deleted"));
}

// EV-09 まとめて入力
export async function bulkShiftAction(month: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("attendance_admin", shiftsUrl(month));
  const values = formValues(formData);
  const errors: Record<string, string> = {};

  // 手順2 CH-11
  const employeeIds = formData.getAll("employee_ids").map(String).filter(isUuid);
  const from = formText(formData, "from");
  const to = formText(formData, "to");
  const weekdays = new Set(formData.getAll("weekdays").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6));
  const mode = formText(formData, "mode");
  const skipClosed = formText(formData, "skip_closed") === "1";
  const overwrite = formText(formData, "overwrite") === "1";

  if (employeeIds.length === 0) errors.employee_ids = "従業員を1人以上選んでください。";
  if (!isValidDateStr(from) || !isValidDateStr(to)) errors.from = "期間を正しく入力してください。";
  else if (from > to) errors.from = "期間の始まりは終わり以前にしてください。";
  else if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > BULK_MAX_DAYS) errors.from = `期間は${BULK_MAX_DAYS}日以内にしてください。`;
  if (weekdays.size === 0) errors.weekdays = "曜日を1つ以上選んでください。";

  // 内容: 時刻(出勤)か区分(休み)のどちらか
  const shiftForm = new FormData();
  if (mode === "times") {
    shiftForm.set("kind", "work");
    for (const key of ["start_time", "end_time", "break_minutes", "location_id"]) shiftForm.set(key, formText(formData, key));
  } else if (mode === "leave") {
    const kind = formText(formData, "leave_kind");
    shiftForm.set("kind", kind === "paid_leave" || kind === "special_leave" || kind === "absence" ? kind : "");
  } else {
    errors.mode = "時刻か区分のどちらかを選んでください。";
  }
  const result = errors.mode ? null : await validateShiftInput(shiftForm, errors);
  if (errors.kind) {
    errors.leave_kind = "区分を選んでください。";
    delete errors.kind;
  }
  if (Object.keys(errors).length > 0 || !result) return { errors, formError: null, values };

  // 従業員は在籍中で勤怠の対象の人
  const period = payrollPeriodOf(from);
  const employees = await listAttendanceEmployees(period.from, to, employeeIds);
  if (employees.length !== employeeIds.length || employees.some((e) => !e.isActive)) {
    return { errors: { employee_ids: "選べない従業員が含まれています。" }, formError: null, values };
  }

  // 対象の日(曜日・休業日)。CH-10 期間の中に締め済みの日が1日でもあれば保存しない
  const calendar = await getCalendar(from, to);
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!weekdays.has(weekdayOfDateStr(d))) continue;
    // 休業日(定休日・臨時休業)と祝日は入れない(02 の G04)
    const cal = calendar.get(d);
    if (skipClosed && cal && (cal.isClosed || cal.kind === "national")) continue;
    dates.push(d);
  }
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (await isPayrollClosed(d)) return { errors: {}, formError: "期間の中に締め済みの日があります。", values };
  }
  if (dates.length === 0) return { errors: { weekdays: "対象の日がありません。" }, formError: null, values };

  // 手順3 1つのトランザクションで登録する
  let counts: { inserted: number; overwritten: number; skipped: number };
  try {
    counts = await transaction(
      async (tx) =>
        await bulkUpsertShifts(
          tx,
          employeeIds.flatMap((employeeId) => dates.map((workDate) => ({ employeeId, workDate }))),
          result.input,
          overwrite,
          me.id
        ),
      { timeoutMs: 60000 }
    );
  } catch (e) {
    console.error("シフトをまとめて登録できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "保存できませんでした。", values };
  }

  // 手順4・5
  await recheck(employeeIds, dates);
  revalidatePath("/admin/attendance");
  const saved = counts.inserted + counts.overwritten;
  redirect(shiftsUrl(month, `&bulk_done=${saved}-${counts.overwritten}-${counts.skipped}`));
}

