// G06 商品のCSV取り込みの「内容を確認する」(EV-11)・「登録する」(EV-12)。
// ファイル(4MBまで)を受け取るため、Server Action(送れる大きさが1MBまで。広げる設定は試験段階の機能)ではなく
// Route Handler にした。画面(ProductImportForm)から fetch で送り、結果を JSON で返す。
// 先頭で requireAccess を呼ぶ。未ログインなどのときはログイン画面などへの移動(redirect)になる。
import { requireAccess } from "@/utils/auth";
import { transaction } from "@/utils/db";
import { ENCODING_LABELS } from "@/utils/csvImport/decode";
import { readUploadedCsv } from "@/utils/csvImport/engine";
import { createPreviewBatch, getBatch, lockBatch, markBatchApplied } from "@/utils/csvImport/batches";
import { applyProductImport, planProductImport, previewRows } from "@/utils/productCsv";
import { relinkSalesProducts } from "@/utils/salesRelink";
import { revalidatePath } from "next/cache";
import { checkPreviewBatch, PRODUCT_CSV_READ_OPTIONS } from "../importChecks";
import type { ProductImportResponse } from "../importTypes";

// 8,000件程度の登録を想定し、実行時間の上限を長めにする(A-01 01 7.6)
export const maxDuration = 60;

const json = (body: ProductImportResponse, status = 200) => Response.json(body, { status });

// 別のサイトから送られた要求を受け付けない(Server Action と同じく、送り元が同じサイトかを見る)
const sameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

export async function POST(request: Request) {
  const me = await requireAccess("products", "/admin/products/import");
  if (!sameOrigin(request)) return json({ ok: false, error: "この画面から操作してください。" }, 403);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: PRODUCT_CSV_READ_OPTIONS.fileError }, 400);
  }
  const intent = formData.get("intent");

  // EV-11 手順2〜4: ファイルを読む(CH-20・CH-24。文字コードの判定は A-01 の共通の処理)
  const read = await readUploadedCsv(formData.get("file"), PRODUCT_CSV_READ_OPTIONS);
  if (!read.ok) return json({ ok: false, error: read.error });

  if (intent === "preview") {
    // EV-11 手順4・5: 見出し(CH-21)・行のチェック(CH-22・CH-23)・区分を決める
    let plan;
    try {
      plan = await planProductImport(read.header, read.rows);
    } catch (e) {
      console.error("商品のCSVを確認できませんでした:", e instanceof Error ? e.message : e);
      return json({ ok: false, error: "データの読み込みに失敗しました。もう一度お試しください。" });
    }
    if (!plan.ok) return json({ ok: false, error: plan.error });

    // 手順6: 取り込みの記録(previewed)の行だけ作る。各行の判定結果は保存しない
    let batchId: string;
    try {
      batchId = await createPreviewBatch({
        kind: "products",
        fileName: read.fileName,
        fileSize: read.fileSize,
        fileHash: read.fileHash,
        encoding: read.encoding,
        dataRowCount: plan.dataRowCount,
        counts: plan.counts,
        createdBy: me.id,
      });
    } catch (e) {
      console.error("取り込みの記録を作れませんでした:", e instanceof Error ? e.message : e);
      return json({ ok: false, error: "保存できませんでした。もう一度お試しください。" });
    }

    return json({
      ok: true,
      step: "preview",
      preview: {
        batchId,
        fileName: read.fileName,
        encodingLabel: ENCODING_LABELS[read.encoding],
        dataRowCount: plan.dataRowCount,
        counts: { add: plan.counts.add, update: plan.counts.change, same: plan.counts.same, error: plan.counts.error },
        unusedColumns: plan.unusedColumns,
        warnings: read.hasReplacementChar
          ? ["文字化けしているかもしれません。書き出したときの文字コードを確かめてください。"]
          : [],
        rows: previewRows(plan.rows),
      },
    });
  }

  if (intent !== "apply") return json({ ok: false, error: "もう一度『内容を確認する』を押してください。" }, 400);

  // EV-12 手順2: CH-25 取り込みの記録が確認中で、確認した本人か社長か
  const batchId = String(formData.get("batch_id") ?? "");
  const batch = await getBatch(batchId);
  const batchError = checkPreviewBatch(batch, me, new Date());
  if (batchError || !batch) return json({ ok: false, error: batchError ?? "もう一度『内容を確認する』を押してください。" });
  // 手順2b: 指紋が記録と同じか(確認したファイルと同じか)
  if (batch.fileHash !== read.fileHash)
    return json({ ok: false, error: "確認したファイルと違います。もう一度『内容を確認する』を押してください。" });

  // 手順2b: 確認の画面の内容は使わず、もう一度チェックして区分を決め直す
  const plan = await planProductImport(read.header, read.rows);
  if (!plan.ok) return json({ ok: false, error: plan.error });
  // 手順3: エラーの行があるのに「エラーの行を除いて登録する」が無ければ登録しない
  if (plan.counts.error > 0 && formData.get("skip_errors") !== "1")
    return json({ ok: false, error: "エラーの行があります。「エラーの行を除いて登録する」にチェックしてください。" });
  if (plan.counts.add + plan.counts.change === 0) return json({ ok: false, error: "登録する内容がありません。" });

  // 手順4〜6: 1つのトランザクションで保存し、記録を登録済みにする。どれか1件でも失敗したら全部やめる
  let result: { added: number; updated: number } | "already";
  try {
    result = await transaction(
      async (tx) => {
        const locked = await lockBatch(tx, batch.id);
        if (!locked || locked.status !== "previewed") return "already" as const;
        const applied = await applyProductImport(tx, plan.rows, me.id);
        await markBatchApplied(
          tx,
          batch.id,
          { ...plan.counts, add: applied.added, change: applied.updated },
          plan.dataRowCount,
          me.id
        );
        return applied;
      },
      { timeoutMs: 55_000 }
    );
  } catch (e) {
    console.error("商品のCSVを登録できませんでした:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "登録できませんでした。何も登録されていません。" });
  }
  if (result === "already") return json({ ok: false, error: "この取り込みはすでに登録済み・取消済みです。" });

  // 手順7: A-01 の結び付け直し(失敗しても商品の登録は取り消さない)
  let relinked = "";
  try {
    const n = await relinkSalesProducts();
    if (n !== null) relinked = `,${n}`;
  } catch (e) {
    console.error("売上の商品の結び付け直しに失敗しました:", e instanceof Error ? e.message : e);
    relinked = ",failed";
  }

  revalidatePath("/admin/products");
  return json({ ok: true, step: "applied", redirectTo: `/admin/products?imported=${result.added},${result.updated}${relinked}` });
}
