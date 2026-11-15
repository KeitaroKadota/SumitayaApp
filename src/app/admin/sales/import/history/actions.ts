"use server";

// G03 取り込みの記録の「取消」(A-01 EV-04、04 CH-15)。確認の小窓は画面で出す。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { getBatch } from "@/utils/csvImport/batches";
import { salesKindOf } from "@/utils/csvImport/kinds/salesColumns";
import { query } from "@/utils/db";
import { cancelSalesBatch } from "@/utils/salesImport";

const HISTORY = "/admin/sales/import/history";

export async function cancelSalesImport(batchId: string): Promise<void> {
  // 手順1 記録を読み、種類の機能キーで権限を見る(A-01 の種類は sales)
  const me = await requireAccess("sales", HISTORY);
  const batch = await getBatch(batchId);
  // 手順2 CH-15: 取消できる種類(A-01 の2つ)・登録済み・取り込んだ本人か社長(【仮】A-01-仮-04)
  if (!batch || !salesKindOf(batch.kind)) redirect(`${HISTORY}?error=notfound`);
  if (batch.status !== "applied") redirect(`${HISTORY}?error=status`);
  const [row] = await query((sql) => sql<{ applied_by: string | null }[]>`select applied_by from import_batches where id = ${batch.id}`);
  if (row?.applied_by !== me.id && !me.roles.includes("president")) redirect(`${HISTORY}?error=owner`);

  // 手順4〜7
  let result: Awaited<ReturnType<typeof cancelSalesBatch>> | null = null;
  try {
    result = await cancelSalesBatch(batch.id, me.id);
  } catch (e) {
    console.error("取り込みを取消できませんでした:", e instanceof Error ? e.message : e);
  }
  if (!result) redirect(`${HISTORY}?error=failed`);
  if (!result.ok) redirect(`${HISTORY}?error=status`);
  revalidatePath("/admin/sales");
  revalidatePath(HISTORY);
  redirect(`${HISTORY}?cancelled=${result.deleted}`);
}
