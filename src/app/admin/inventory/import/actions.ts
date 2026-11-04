"use server";

// G04 在庫CSVの取り込みの「やめる」。在庫は変えず、確認中の取り込みの記録を取消にする
// (登録した後の取り込みは取消できない。B-01 01 7.2)。
import { requireAccess } from "@/utils/auth";
import { getBatch, markBatchCancelled } from "@/utils/csvImport/batches";
import { checkCrossmallPreviewBatch } from "@/utils/crossmall/importChecks";

export async function cancelStockImport(batchId: string): Promise<{ error: string | null }> {
  const me = await requireAccess("orders", "/admin/inventory/import");
  const batch = await getBatch(batchId);
  const error = checkCrossmallPreviewBatch(batch, "crossmall_stock", me, new Date());
  if (error || !batch) return { error: error ?? "もう一度『読み込む』を押してください。" };
  try {
    await markBatchCancelled(batch.id, me.id);
  } catch (e) {
    console.error("取り込みを取り消せませんでした:", e instanceof Error ? e.message : e);
    return { error: "取り消せませんでした。時間をおいてもう一度お試しください。" };
  }
  return { error: null };
}
