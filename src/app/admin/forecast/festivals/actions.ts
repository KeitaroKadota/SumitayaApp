"use server";

// G03 祭礼カレンダーの「保存」・削除(A-03 EV-05、04 CH-05)
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { checkFestivalInput, deleteFestival, festivalCategoryOptions, getFestival, hasSameYearFestival, saveFestival } from "@/utils/festivals";
import { formValues, type FormState } from "@/utils/formState";

const FESTIVALS_URL = "/admin/forecast/festivals";

export async function saveFestivalAction(id: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  // 手順1
  const me = await requireAccess("sales", FESTIVALS_URL);
  const values = formValues(formData);
  const raw = {
    series_key: values.series_key ?? "",
    name: values.name ?? "",
    start_date: values.start_date ?? "",
    end_date: values.end_date ?? "",
    region: values.region ?? "",
    category_codes: values.category_codes ?? "",
    influence_days_before: values.influence_days_before ?? "",
    influence_days_after: values.influence_days_after ?? "",
    adjust_factor: values.adjust_factor ?? "",
    is_held: values.is_held ?? "",
    note: values.note ?? "",
  };
  if (id && !(await getFestival(id))) return { errors: {}, formError: "この祭礼は見つかりません。", values };
  // 手順2 CH-05
  const { input, errors } = checkFestivalInput(raw, festivalCategoryOptions().map((o) => o.value));
  if (!input) return { errors, formError: null, values };

  // 手順3 保存。CH-05 同じつなぐ名前・同じ年に別の祭礼があれば警告(止めない)
  let warn = false;
  try {
    warn = await hasSameYearFestival(input.seriesKey, input.startDate, id);
    await saveFestival(id, input, me.id);
  } catch (e) {
    if (isUniqueViolation(e)) return { errors: { start_date: "同じつなぐ名前・同じ初日の祭礼がすでにあります。" }, formError: null, values };
    console.error("祭礼を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "保存できませんでした。時間をおいてもう一度お試しください。", values };
  }
  revalidatePath(FESTIVALS_URL);
  // 手順4
  redirect(`${FESTIVALS_URL}?year=${input.startDate.slice(0, 4)}&saved=1${warn ? "&same_year=1" : ""}`);
}

export async function deleteFestivalAction(id: string): Promise<void> {
  await requireAccess("sales", FESTIVALS_URL);
  const current = await getFestival(id);
  if (current) await deleteFestival(current.id);
  revalidatePath(FESTIVALS_URL);
  redirect(`${FESTIVALS_URL}?year=${current ? current.startDate.slice(0, 4) : ""}&saved=deleted`);
}
