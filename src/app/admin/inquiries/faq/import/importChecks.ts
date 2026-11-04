// よくある質問のCSV取り込みのチェック(D-03 03 EV-07。A-01 の共通の取り込みの「確認中の記録」の確かめ方と同じ)。
// 登録(upload/route.ts)と取消(actions.ts)で使う。
import type { CurrentEmployee } from "@/utils/auth";
import type { ImportBatch } from "@/utils/csvImport/batches";
// 【仮】確認してから登録できるまでの時間は、商品の取り込みと同じ値を使う(00_仮決め一覧 CMN02-仮-14)
import { PREVIEW_VALID_HOURS } from "@/app/admin/products/import/importChecks";

// 取り込みの記録が「確認中」で、種類が faq_entries、確認した本人か社長、24時間以内。だめなときは画面に出す文を返す
export const checkFaqPreviewBatch = (batch: ImportBatch | null, me: CurrentEmployee, now: Date): string | null => {
  if (!batch || batch.kind !== "faq_entries") return "もう一度『内容を確認する』を押してください。";
  if (batch.status !== "previewed") return "この取り込みはすでに登録済み・取消済みです。";
  if (batch.createdBy !== me.id && !me.roles.includes("president"))
    return "ほかの人が確認中の取り込みです。もう一度『内容を確認する』を押してください。";
  if (now.getTime() - batch.createdAt.getTime() > PREVIEW_VALID_HOURS * 60 * 60 * 1000)
    return "確認してから時間がたちました。もう一度『内容を確認する』を押してください。";
  return null;
};
