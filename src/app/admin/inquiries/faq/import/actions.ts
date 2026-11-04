"use server";

// よくある質問のCSV取り込みの「取り消す」。FAQは変えず、取り込みの記録を取消にする。
import { requireAccess } from "@/utils/auth";
import { getBatch, markBatchCancelled } from "@/utils/csvImport/batches";
import { checkFaqPreviewBatch } from "./importChecks";

export async function cancelFaqImport(batchId: string): Promise<{ error: string | null }> {
  const me = await requireAccess("inquiry_settings", "/admin/inquiries/faq/import");
  const batch = await getBatch(batchId);
  const error = checkFaqPreviewBatch(batch, me, new Date());
  if (error || !batch) return { error: error ?? "もう一度『内容を確認する』を押してください。" };
  try {
    await markBatchCancelled(batch.id, me.id);
  } catch (e) {
    console.error("取り込みを取り消せませんでした:", e instanceof Error ? e.message : e);
    return { error: "取り消せませんでした。時間をおいてもう一度お試しください。" };
  }
  return { error: null };
}
