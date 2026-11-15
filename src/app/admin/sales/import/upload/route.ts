// G02 売上の取り込みの「内容を確認」(EV-02)・「この内容で登録」(EV-03)。B-01 の取り込みと同じく Route Handler で受け取る
// (4MB のファイルを受け取るため。Server Action の既定の上限は1MB)。先頭で requireAccess を呼ぶ。
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/utils/auth";
import { transaction } from "@/utils/db";
import { ENCODING_LABELS } from "@/utils/csvImport/decode";
import { readUploadedCsv } from "@/utils/csvImport/engine";
import { createPreviewBatch, getBatch, lockBatch, markBatchApplied } from "@/utils/csvImport/batches";
import { SALES_CHANNELS, salesKindOf } from "@/utils/csvImport/kinds/salesColumns";
import { isSameOrigin } from "@/utils/crossmall/importChecks";
import { formatDate, formatDateTime, formatQuantity } from "@/utils/format";
import {
  SALES_CSV_MAX_ROWS,
  applySalesPlan,
  findAppliedSameFile,
  planSalesImport,
  setBatchPeriod,
  type SalesImportPlan,
} from "@/utils/salesImport";
// 【仮】確認してから登録できるまでの時間は、商品の取り込みと同じ値(24時間。A-01 CH-06 の「1日以内」)
import { PREVIEW_VALID_HOURS } from "@/app/admin/products/import/importChecks";
import type { SalesImportResponse } from "../importTypes";

// 数万行の登録を考え、実行時間の上限を長めにする(A-01 01 7.6)
export const maxDuration = 60;

const NEXT = "/admin/sales/import";
// CH-01・CH-02・CH-14
const READ_OPTIONS = {
  extensions: [".csv", ".txt"],
  fileError: "CSVファイルを選んでください（4MBまで）。数年分は1か月ずつに分けて書き出してください。",
  maxRows: SALES_CSV_MAX_ROWS,
  maxRowsError: `1回に取り込めるのは${SALES_CSV_MAX_ROWS.toLocaleString("ja-JP")}行までです。ファイルが途中で切れていないか確かめ、1か月ずつに分けてください。`,
};
const AGAIN = "確認したファイルと違います。もう一度『内容を確認』してください。";

const json = (body: SalesImportResponse, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  // EV-02・EV-03 手順1
  const me = await requireAccess("sales", NEXT);
  if (!isSameOrigin(request)) return json({ ok: false, error: "この画面から操作してください。" }, 403);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: READ_OPTIONS.fileError }, 400);
  }
  const intent = formData.get("intent");

  // EV-02 手順2 決まった種類か
  const def = salesKindOf(String(formData.get("kind") ?? ""));
  if (!def) return json({ ok: false, error: "取り込むものを選んでください。" });

  // 手順3 / EV-03 手順2: ファイルを(もう一度)読む
  const read = await readUploadedCsv(formData.get("file"), READ_OPTIONS);
  if (!read.ok) return json({ ok: false, error: read.error });

  const plan = async (): Promise<SalesImportPlan> => {
    try {
      return await planSalesImport(def.kind, read.header, read.rows);
    } catch (e) {
      console.error("売上のCSVを確認できませんでした:", e instanceof Error ? e.message : e);
      return { ok: false, error: "データの読み込みに失敗しました。" };
    }
  };

  if (intent === "preview") {
    // 手順4 分類
    const planned = await plan();
    if (!planned.ok) return json({ ok: false, error: planned.error });

    // 手順5 CH-05 同じファイルを登録済みか(警告だけ)
    const warnings: string[] = [];
    if (read.hasReplacementChar) warnings.push("文字化けしているかもしれません。書き出したときの文字コードを確かめてください。");
    try {
      const sameAt = await findAppliedSameFile(def.kind, read.fileHash);
      if (sameAt) warnings.push(`同じファイルを ${formatDateTime(sameAt)} に取り込んでいます。`);
    } catch (e) {
      console.error("取り込みの記録を読めませんでした:", e instanceof Error ? e.message : e);
    }
    if (planned.directionWarningCount > 0)
      warnings.push(`数量と金額の向きが違う行が ${formatQuantity(planned.directionWarningCount)}件あります（取り込みはできます）。`);

    // 手順6 取り込みの記録(previewed)の行だけ作る。作れなくても確認の結果は出す
    let batchId = "";
    try {
      batchId = await createPreviewBatch({
        kind: def.kind,
        fileName: read.fileName,
        fileSize: read.fileSize,
        fileHash: read.fileHash,
        encoding: read.encoding,
        dataRowCount: planned.dataRowCount,
        counts: planned.counts,
        createdBy: me.id,
      });
      await setBatchPeriod(batchId, planned.periodFrom, planned.periodTo);
    } catch (e) {
      console.error("取り込みの記録を作れませんでした:", e instanceof Error ? e.message : e);
    }

    // 手順7
    return json({
      ok: true,
      step: "preview",
      preview: {
        batchId,
        kindLabel: def.label,
        fileName: read.fileName,
        encodingLabel: ENCODING_LABELS[read.encoding],
        periodLabel:
          planned.periodFrom && planned.periodTo ? `${formatDate(planned.periodFrom)}〜${formatDate(planned.periodTo)}` : "（取り込む行がありません）",
        dataRowCount: planned.dataRowCount,
        channelLabel: planned.channels.map((c) => SALES_CHANNELS[c]).join("・") || "−",
        counts: planned.counts,
        unknownProductCount: planned.unknownProductCount,
        warnings,
        unusedColumns: planned.unusedColumns,
        rows: planned.previewRows,
      },
    });
  }

  if (intent !== "apply") return json({ ok: false, error: "もう一度『内容を確認』してください。" }, 400);

  // EV-03 手順3・4 CH-06 確認したものと同じ取り込みか
  const batch = await getBatch(String(formData.get("batch_id") ?? ""));
  if (!batch) return json({ ok: false, error: "もう一度『内容を確認』してください。" });
  if (
    batch.status !== "previewed" ||
    batch.kind !== def.kind ||
    batch.createdBy !== me.id ||
    batch.fileHash !== read.fileHash ||
    Date.now() - batch.createdAt.getTime() > PREVIEW_VALID_HOURS * 60 * 60 * 1000
  )
    return json({ ok: false, error: batch.status === "applied" ? "この取り込みはすでに登録されています。" : AGAIN });

  // 手順5 分類し直す・手順6 何もなければ終わり
  const planned = await plan();
  if (!planned.ok) return json({ ok: false, error: planned.error });
  const c = planned.counts;
  if (c.add + c.change + c.delete === 0) return json({ ok: false, error: "登録する内容がありません。" });

  // 手順7〜13 1つのトランザクションで保存する。途中で失敗したら何も残さない
  let result: "ok" | "already";
  try {
    result = await transaction(
      async (tx) => {
        const locked = await lockBatch(tx, batch.id);
        if (!locked || locked.status !== "previewed") return "already" as const;
        await applySalesPlan(tx, def.kind, planned, batch.id);
        await markBatchApplied(tx, batch.id, c, planned.dataRowCount, me.id);
        await setBatchPeriod(batch.id, planned.periodFrom, planned.periodTo, tx);
        return "ok" as const;
      },
      { timeoutMs: 55_000 }
    );
  } catch (e) {
    console.error("売上を登録できませんでした:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "登録に失敗しました。何も保存していません。もう一度お試しください。" });
  }
  if (result === "already") return json({ ok: false, error: "この取り込みはすでに登録されています。" });

  // 手順14・15
  revalidatePath("/admin/sales");
  revalidatePath("/admin/sales/import/history");
  const period = planned.periodFrom && planned.periodTo ? `（${formatDate(planned.periodFrom)}〜${formatDate(planned.periodTo)}）` : "";
  return json({
    ok: true,
    step: "applied",
    message: `取り込みました${period}: 追加 ${formatQuantity(c.add)} / 変更 ${formatQuantity(c.change)} / 削除 ${formatQuantity(c.delete)} / エラーで取り込まなかった行 ${formatQuantity(c.error)}`,
  });
}
