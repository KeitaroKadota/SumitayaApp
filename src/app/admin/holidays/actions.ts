"use server";

// 祝日・休業日の操作(CMN-02 EV-18〜EV-21)。機能キー holidays(社長・店舗)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { formValues, type FormState } from "@/utils/formState";
import { yearHolidayCandidates } from "@/utils/holidays";
import { MAX_HOLIDAY_NAME, MAX_NOTE } from "@/utils/masterRules";
import { formText, isValidDateStr } from "@/utils/textNormalize";
import {
  deleteHoliday,
  getHolidayByDate,
  getHolidayById,
  insertTemporaryClosed,
  insertYearHolidays,
  setHolidayClosed,
  updateHoliday,
} from "./holidayData";
import { holidaysUrl, parseYear } from "./holidayYear";

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";

// CH-27 休業日の名前: 空はだめ。50文字以内
const checkName = (name: string): string | null =>
  !name ? "名前を入力してください。" : name.length > MAX_HOLIDAY_NAME ? `名前は${MAX_HOLIDAY_NAME}文字以内で入力してください。` : null;

// EV-18 「この年の休日を作る」。確認のダイアログは画面で出す
export async function generateYearHolidays(year: number): Promise<void> {
  const y = parseYear(year);
  await requireAccess("holidays", holidaysUrl(y));
  // 手順2〜4: 祝日と水・木の候補を作り、すでにある日は作らない・変えない(CH-28)
  const created = await insertYearHolidays(yearHolidayCandidates(y));
  revalidatePath("/admin/holidays");
  redirect(holidaysUrl(y, `&created=${created}`));
}

// EV-19 休業日の「追加する」
export async function addHoliday(year: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("holidays", holidaysUrl(parseYear(year)));
  const values = formValues(formData);
  const date = formText(formData, "date");
  const name = formText(formData, "name");
  const mode = formText(formData, "mode");

  // CH-26 日付・CH-27 名前
  const errors: Record<string, string> = {};
  if (!isValidDateStr(date) || date < "2000-01-01" || date > "2100-12-31")
    errors.date = "日付を正しく入力してください（2000年〜2100年）。";
  const nameError = checkName(name);
  if (nameError) errors.name = nameError;
  if (mode !== "closed" && mode !== "open") errors.mode = "臨時休業か臨時営業かを選んでください。";
  if (Object.keys(errors).length > 0) return { errors, formError: null, values };

  try {
    const existing = await getHolidayByDate(date);
    if (mode === "closed") {
      // 手順3: 行が無ければ臨時休業の行を作る。あれば(例: 祝日)休みにして名前を変える
      if (existing) await setHolidayClosed(existing.id, true, name, me.id);
      else await insertTemporaryClosed(date, name, me.id);
    } else {
      // 手順4: 臨時営業は、ある行を営業にする。行が無ければもともと営業日
      if (!existing) return { errors: { date: "この日はもともと営業日です。" }, formError: null, values };
      await setHolidayClosed(existing.id, false, name, me.id);
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { errors: { date: "この日はすでに登録されています。もう一度お試しください。" }, formError: null, values };
    console.error("休業日を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  revalidatePath("/admin/holidays");
  redirect(holidaysUrl(Number(date.slice(0, 4)), "&saved=1"));
}

// EV-20 「変更する」(モーダル)で保存する。日付・種別は変えない
export async function saveHoliday(holidayId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("holidays", "/admin/holidays");
  const current = await getHolidayById(holidayId);
  const year = current ? Number(current.date.slice(0, 4)) : parseYear(null);
  const values = formValues(formData);
  if (!current) return { errors: {}, formError: "この日は見つかりません。", values };

  const name = formText(formData, "name");
  const note = formText(formData, "note");
  const closed = formText(formData, "is_closed");
  const errors: Record<string, string> = {};
  const nameError = checkName(name);
  if (nameError) errors.name = nameError;
  if (closed !== "1" && closed !== "0") errors.is_closed = "休みか営業かを選んでください。";
  if (note.length > MAX_NOTE) errors.note = `メモは${MAX_NOTE}文字以内で入力してください。`;
  if (Object.keys(errors).length > 0) return { errors, formError: null, values };

  try {
    await updateHoliday(current.id, { name, isClosed: closed === "1", note: note || null }, me.id);
  } catch (e) {
    console.error("休業日を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  revalidatePath("/admin/holidays");
  redirect(holidaysUrl(year, "&saved=1"));
}

// EV-21 「削除する」。確認のダイアログは画面で出す
export async function deleteHolidayAction(holidayId: string): Promise<void> {
  await requireAccess("holidays", "/admin/holidays");
  const current = await getHolidayById(holidayId);
  const year = current ? Number(current.date.slice(0, 4)) : parseYear(null);
  if (current) await deleteHoliday(current.id);
  revalidatePath("/admin/holidays");
  redirect(holidaysUrl(year, "&saved=deleted"));
}
