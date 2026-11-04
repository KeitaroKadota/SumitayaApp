// G04 在庫CSVの「読み込む」(EV-05)・「登録する」(EV-06)。受注CSV(orders/import/upload)と同じく Route Handler で受け取る。
// 先頭で requireAccess を呼ぶ。未ログインなどのときはログイン画面などへの移動(redirect)になる。
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/utils/auth";
import { transaction } from "@/utils/db";
import { ENCODING_LABELS } from "@/utils/csvImport/decode";
import { readUploadedCsv } from "@/utils/csvImport/engine";
import { createPreviewBatch, getBatch, lockBatch, markBatchApplied } from "@/utils/csvImport/batches";
import {
  checkCrossmallPreviewBatch,
  crossmallReadOptions,
  isSameOrigin,
  type CrossmallImportResponse,
} from "@/utils/crossmall/importChecks";
import { recordInventoryKpi } from "@/utils/crossmall/laterLinks";
import { formatQuantity } from "@/utils/format";
import {
  STOCK_CSV_MAX_ROWS,
  applyStocks,
  planStockImport,
  previewStockRows,
  stocksToApply,
  type StockImportPlan,
  type StockPlanKind,
} from "@/utils/inventoryLevels";
import { todayJST } from "@/utils/jst";

// 8,000品程度の在庫CSVを考え、実行時間の上限を長めにする(商品の取り込みと同じ)
export const maxDuration = 60;

const NEXT = "/admin/inventory/import";
const READ_OPTIONS = crossmallReadOptions(STOCK_CSV_MAX_ROWS);
const KIND_LABELS: Record<StockPlanKind, string> = {
  add: "新規",
  update: "更新",
  same: "変更なし",
  skip: "未登録",
  error: "エラー",
};

const json = (body: CrossmallImportResponse, status = 200) => Response.json(body, { status });

// 確認の画面に出す件数と警告(02 G04)
const previewBody = (plan: Extract<StockImportPlan, { ok: true }>) => {
  const c = plan.counts;
  const changed = plan.increased + plan.decreased;
  const summary = [
    `行数 ${formatQuantity(plan.dataRowCount)}行 → 商品マスタと一致 ${formatQuantity(plan.matchedCount)}品／未登録 ${formatQuantity(c.skip)}品（登録しない）`,
    `在庫数が前回から変わった商品 ${formatQuantity(changed)}品（増 ${formatQuantity(plan.increased)}・減 ${formatQuantity(plan.decreased)}）`,
    `在庫が0になった商品 ${formatQuantity(plan.becameZero)}品`,
  ];
  // CH-08 未登録の商品コード(件数と先頭10件)
  const warnings =
    c.skip > 0
      ? [
          `商品マスタに無い商品コード ${formatQuantity(c.skip)}品: ${plan.unknownCodes.join("、")}${c.skip > plan.unknownCodes.length ? " ほか" : ""}（この行は登録しません。商品マスタに足してから取り込み直してください）`,
        ]
      : [];
  return {
    summary,
    warnings,
    errorCount: c.error,
    hasChanges: plan.matchedCount > 0,
    applyLabel: "登録する",
    tabs: [
      { key: "update", label: "更新", count: c.change },
      { key: "add", label: "新規", count: c.add },
      { key: "skip", label: "未登録", count: c.skip },
      { key: "error", label: "エラー", count: c.error },
    ],
    rows: previewStockRows(plan.entries).map((r) => ({
      line: r.line,
      kind: r.kind,
      kindLabel: KIND_LABELS[r.kind],
      isError: r.kind === "error",
      key: r.productCode,
      sub: r.productName,
      detail: r.detail,
      warning: r.warning,
    })),
  };
};

export async function POST(request: Request) {
  // EV-05・EV-06 手順1
  const me = await requireAccess("orders", NEXT);
  if (!isSameOrigin(request)) return json({ ok: false, error: "この画面から操作してください。" }, 403);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: READ_OPTIONS.fileError }, 400);
  }
  const intent = formData.get("intent");

  // EV-05 手順2: CH-01、文字コードを判定して読む(A-01 の共通の処理)
  const read = await readUploadedCsv(formData.get("file"), READ_OPTIONS);
  if (!read.ok) return json({ ok: false, error: read.error });

  const plan = async (): Promise<StockImportPlan> => {
    try {
      return await planStockImport(read.header, read.rows);
    } catch (e) {
      console.error("在庫CSVを確認できませんでした:", e instanceof Error ? e.message : e);
      return { ok: false, error: "データの読み込みに失敗しました。もう一度お試しください。" };
    }
  };

  if (intent === "preview") {
    // EV-05 手順2〜5
    const planned = await plan();
    if (!planned.ok) return json({ ok: false, error: planned.error });

    // 手順6: 取り込みの記録(previewed)の行だけ作る。整えた結果は保存しない
    let batchId: string;
    try {
      batchId = await createPreviewBatch({
        kind: "crossmall_stock",
        fileName: read.fileName,
        fileSize: read.fileSize,
        fileHash: read.fileHash,
        encoding: read.encoding,
        dataRowCount: planned.dataRowCount,
        counts: planned.counts,
        createdBy: me.id,
      });
    } catch (e) {
      console.error("取り込みの記録を作れませんでした:", e instanceof Error ? e.message : e);
      return json({ ok: false, error: "保存できませんでした。もう一度お試しください。" });
    }

    const body = previewBody(planned);
    return json({
      ok: true,
      step: "preview",
      preview: {
        batchId,
        fileName: read.fileName,
        encodingLabel: ENCODING_LABELS[read.encoding],
        dataRowCount: planned.dataRowCount,
        unusedColumns: planned.unusedColumns,
        ...body,
        warnings: [
          ...(read.hasReplacementChar ? ["文字化けしているかもしれません。書き出したときの文字コードを確かめてください。"] : []),
          ...body.warnings,
        ],
      },
    });
  }

  if (intent !== "apply") return json({ ok: false, error: "もう一度『読み込む』を押してください。" }, 400);

  // EV-06 手順1: 共通のチェック(確認中・本人)、指紋、EV-05 の手順2〜5 のやり直し、CH-09
  const batch = await getBatch(String(formData.get("batch_id") ?? ""));
  const batchError = checkCrossmallPreviewBatch(batch, "crossmall_stock", me, new Date());
  if (batchError || !batch) return json({ ok: false, error: batchError ?? "この取り込みは登録できません。" });
  if (batch.fileHash !== read.fileHash)
    return json({ ok: false, error: "確認したファイルと違います。もう一度『読み込む』を押してください。" });
  const planned = await plan();
  if (!planned.ok) return json({ ok: false, error: planned.error });
  if (planned.counts.error > 0)
    return json({ ok: false, error: "エラーがあるため登録できません。CSVを直して読み込み直してください。" });
  const stocks = stocksToApply(planned.entries);
  if (stocks.length === 0) return json({ ok: false, error: "登録する内容がありません。" });

  // 手順2〜4: 1つのトランザクションで上書きし、記録を登録済みにする。失敗したら全部取りやめる
  let saved: number | "already";
  try {
    saved = await transaction(
      async (tx) => {
        const locked = await lockBatch(tx, batch.id);
        if (!locked || locked.status !== "previewed") return "already" as const;
        const n = await applyStocks(tx, stocks);
        await markBatchApplied(tx, batch.id, planned.counts, planned.dataRowCount, me.id);
        return n;
      },
      { timeoutMs: 55_000 }
    );
  } catch (e) {
    console.error("在庫CSVを登録できませんでした:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "登録できませんでした。何も登録されていません。" });
  }
  if (saved === "already") return json({ ok: false, error: "この取り込みはすでに登録済み・取消済みです。" });

  // 手順5: 確定の後に A-05 の在庫の指標を記録する(失敗しても取り込みは成功のまま)
  let kpi = "";
  try {
    const recorded = await recordInventoryKpi(todayJST());
    if (recorded === false) kpi = ",kpi_failed";
  } catch (e) {
    console.error("在庫の指標を記録できませんでした:", e instanceof Error ? e.message : e);
    kpi = ",kpi_failed";
  }

  // 手順6: G05 へ(?imported=品数[,kpi_failed])
  revalidatePath("/admin/inventory");
  return json({ ok: true, step: "applied", redirectTo: `/admin/inventory?imported=${saved}${kpi}` });
}
