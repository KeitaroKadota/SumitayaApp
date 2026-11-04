"use server";

// 従業員の詳細(CMN-02 の G03)の「LINE通知」欄の操作(CMN-03 EV-13・EV-14)。社長だけが使える(機能キー tasks_admin)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { clearLineLink } from "@/utils/lineAccount";
import { sendLineTest } from "@/utils/lineTest";
import { isUuid } from "./employeeData";

const detailUrl = (employeeId: string) => `/admin/employees/${encodeURIComponent(employeeId)}`;

// EV-13 「テスト送信する」(社長が他人へ)
export async function sendEmployeeLineTest(employeeId: string) {
  await requireAccess("tasks_admin", detailUrl(employeeId));
  if (!isUuid(employeeId)) redirect("/admin/employees");
  const result = await sendLineTest(employeeId);
  redirect(`${detailUrl(employeeId)}?line_test=${result}`);
}

// EV-14 「連携を解除する」(確認のダイアログは画面で出す)
export async function unlinkEmployeeLine(employeeId: string) {
  const me = await requireAccess("tasks_admin", detailUrl(employeeId));
  if (!isUuid(employeeId)) redirect("/admin/employees");
  await clearLineLink(employeeId, me.id);
  revalidatePath("/admin/employees");
  redirect(`${detailUrl(employeeId)}?line_unlinked=1`);
}
