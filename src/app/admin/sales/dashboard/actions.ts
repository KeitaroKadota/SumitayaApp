"use server";

// G01 在庫の指標の「今日の数字を記録し直す」(A-05 EV-02)
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { recordInventoryKpi } from "@/utils/inventoryKpi";
import { todayJST } from "@/utils/jst";

export async function recordKpiAgain(): Promise<void> {
  // 手順1
  await requireAccess("sales", "/admin/sales/dashboard");
  // 手順2 今日の日付で呼ぶ(上書き)
  let result = "recorded=1";
  try {
    const r = await recordInventoryKpi(todayJST(), { force: true });
    if (!r.ok) result = `record_failed=${encodeURIComponent(r.reason)}`;
  } catch (e) {
    console.error("在庫の指標を記録できませんでした:", e instanceof Error ? e.message : e);
    result = "record_failed=1";
  }
  // 手順3
  revalidatePath("/admin/sales/dashboard");
  redirect(`/admin/sales/dashboard?${result}`);
}
