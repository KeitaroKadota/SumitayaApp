"use server";

// G06 商品のCSV取り込みの「取り消す」(CMN-02 EV-13)。商品は変えず、取り込みの記録を取消にする。
import { requireAccess } from "@/utils/auth";
import { getBatch, markBatchCancelled } from "@/utils/csvImport/batches";
import { checkPreviewBatch } from "./importChecks";

export async function cancelProductImport(batchId: string): Promise<{ error: string | null }> {
  const me = await requireAccess("products", "/admin/products/import");
  // CH-25
  const batch = await getBatch(batchId);
  const error = checkPreviewBatch(batch, me, new Date());
  // 確認の期限を過ぎた・すでに登録済みなどのときは記録を変えない(画面は手順1に戻し、理由を出す)
  if (error || !batch) return { error: error ?? "もう一度『内容を確認する』を押してください。" };
  try {
    await markBatchCancelled(batch.id, me.id);
  } catch (e) {
    console.error("取り込みを取り消せませんでした:", e instanceof Error ? e.message : e);
    return { error: "取り消せませんでした。時間をおいてもう一度お試しください。" };
  }
  return { error: null };
}
