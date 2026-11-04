"use server";

// G02 明細の取り込みの「やり直す」。明細は変えず、確認中の取り込みの記録を取消にする
// (登録した後の取り込みの取消は G01 の「取り込みを取り消す」。EV-09)。
import { requireAccess } from "@/utils/auth";
import { getBatch, markBatchCancelled } from "@/utils/csvImport/batches";
import { IMPORT_URL } from "../depositsUrl";
import { checkBankPreviewBatch } from "./importChecks";

export async function cancelBankPreview(batchId: string): Promise<{ error: string | null }> {
  const me = await requireAccess("receivables", IMPORT_URL);
  const batch = await getBatch(batchId);
  const error = checkBankPreviewBatch(batch, me, new Date());
  // 確認中でなくなっていれば、やり直すだけでよい
  if (error || !batch) return { error: null };
  try {
    await markBatchCancelled(batch.id, me.id);
  } catch (e) {
    console.error("取り込みを取り消せませんでした:", e instanceof Error ? e.message : e);
    return { error: "取り消せませんでした。時間をおいてもう一度お試しください。" };
  }
  return { error: null };
}
