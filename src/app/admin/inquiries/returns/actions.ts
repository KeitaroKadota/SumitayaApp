"use server";

// D-06 G03 返品の詳細の操作(03 EV-10 取消)。機能キー inquiries(社長・店舗)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fullName, requireAccess } from "@/utils/auth";
import { formatDateTime } from "@/utils/format";
import { UUID_PATTERN } from "@/utils/inquiries";
import { cancelReturnRequest, getReturnRequest } from "@/utils/returnRequests";
import { RETURN_LIMITS, canCancelReturn } from "@/utils/returnRules";

const LIST_URL = "/admin/inquiries/returns";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;

// EV-10 取消(理由をメモに足す)
export async function cancelReturnAction(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("inquiries", detailUrl(id));
  const request = UUID_PATTERN.test(id) ? await getReturnRequest(id) : null;
  if (!request) redirect(LIST_URL);
  // CH-06 取消からは移れない
  if (!canCancelReturn(request.status)) redirect(`${detailUrl(id)}?error=status`);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) redirect(`${detailUrl(id)}?error=reason`);
  if (reason.length > RETURN_LIMITS.cancelReason) redirect(`${detailUrl(id)}?error=reason_long`);

  const ok = await cancelReturnRequest(id, `${formatDateTime(new Date())} 取消（${fullName(me)}）: ${reason}`, me.id);
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(id));
  redirect(`${detailUrl(id)}?${ok ? "done=cancelled" : "error=status"}`);
}
