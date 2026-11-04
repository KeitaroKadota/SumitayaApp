// G03 受注CSVの「読み込む」(EV-03)・「登録する」(EV-04)。
// ファイル(4MBまで)を受け取るため、商品の取り込みと同じく Server Action ではなく Route Handler にした
// (Server Action で送れる大きさは1MBまでで、広げる設定は試験段階の機能のため)。画面(CrossmallImportForm)から fetch で送り、結果を JSON で返す。
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
import { detectOrderExceptions } from "@/utils/crossmall/laterLinks";
import { formatDate, formatDateShort, formatQuantity, formatTime } from "@/utils/format";
import {
  ORDER_CSV_MAX_ROWS,
  applyOrders,
  planOrderImport,
  previewOrderRows,
  type ApplyOrdersResult,
  type OrderImportPlan,
  type OrderPlanKind,
} from "@/utils/orders";

// 初回に過去分をまとめて入れる場合を考え、実行時間の上限を長めにする(商品の取り込みと同じ)
export const maxDuration = 60;

const NEXT = "/admin/orders/import";
const READ_OPTIONS = crossmallReadOptions(ORDER_CSV_MAX_ROWS);
const KIND_LABELS: Record<OrderPlanKind, string> = { add: "新規", update: "更新", same: "変更なし", error: "エラー" };

const json = (body: CrossmallImportResponse, status = 200) => Response.json(body, { status });

// 確認の画面に出す件数と警告(02 G03)
const previewBody = (plan: Extract<OrderImportPlan, { ok: true }>) => {
  const c = plan.counts;
  const orderCount = c.add + c.change + c.same;
  const summary = [
    `行数 ${formatQuantity(plan.dataRowCount)}行 → 注文 ${formatQuantity(orderCount)}件（新規 ${formatQuantity(c.add)}件・更新 ${formatQuantity(c.change)}件・変更なし ${formatQuantity(c.same)}件）`,
  ];
  // CH-14 切替日が設定されていれば、売上に積み上げる注文の数
  if (plan.cutoverDate)
    summary.push(`売上に積み上げる注文 ${formatQuantity(plan.salesTargetCount)}件（${formatDate(plan.cutoverDate)} 以後）`);
  const warnings: string[] = [];
  // CH-08 商品マスタに無い商品コード(登録はできる)
  if (plan.unknownProductCodes.length > 0) {
    const shown = plan.unknownProductCodes.slice(0, 10).join("、");
    warnings.push(
      `商品マスタに無い商品コード ${formatQuantity(plan.unknownProductCodes.length)}種類: ${shown}${plan.unknownProductCodes.length > 10 ? " ほか" : ""}（「未登録」として取り込みます）`
    );
  }
  warnings.push(...plan.salesWarnings);
  const rows = previewOrderRows(plan.entries).map((r) => ({
    line: r.line,
    kind: r.kind,
    kindLabel: KIND_LABELS[r.kind],
    isError: r.kind === "error",
    key: r.crossmallOrderNo,
    sub: r.orderedAt ? `${formatDateShort(r.orderedAt)}${formatTime(r.orderedAt)}` : "",
    detail: r.detail,
    warning: r.warning,
  }));
  return {
    summary,
    warnings,
    errorCount: c.error,
    hasChanges: c.add + c.change > 0,
    applyLabel: `登録する（${formatQuantity(c.add + c.change)}件）`,
    tabs: [
      { key: "add", label: "新規", count: c.add },
      { key: "update", label: "更新", count: c.change },
      { key: "same", label: "変更なし", count: c.same },
      { key: "error", label: "エラー", count: c.error },
    ],
    rows,
  };
};

export async function POST(request: Request) {
  // EV-03・EV-04 手順1
  const me = await requireAccess("orders", NEXT);
  if (!isSameOrigin(request)) return json({ ok: false, error: "この画面から操作してください。" }, 403);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: READ_OPTIONS.fileError }, 400);
  }
  const intent = formData.get("intent");

  // EV-03 手順2・3: CH-01、文字コードを判定して読む(A-01 の共通の処理)
  const read = await readUploadedCsv(formData.get("file"), READ_OPTIONS);
  if (!read.ok) return json({ ok: false, error: read.error });

  const plan = async (): Promise<OrderImportPlan> => {
    try {
      return await planOrderImport(read.header, read.rows);
    } catch (e) {
      console.error("受注CSVを確認できませんでした:", e instanceof Error ? e.message : e);
      return { ok: false, error: "データの読み込みに失敗しました。もう一度お試しください。" };
    }
  };

  if (intent === "preview") {
    // EV-03 手順4〜8
    const planned = await plan();
    if (!planned.ok) return json({ ok: false, error: planned.error });

    // 手順9: 取り込みの記録(previewed)の行だけ作る。整えた結果は保存しない
    let batchId: string;
    try {
      batchId = await createPreviewBatch({
        kind: "crossmall_orders",
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

    // 手順10: 確認の画面
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

  // EV-04 手順2: 取り込みの記録が確認中で、本人が作ったものか
  const batch = await getBatch(String(formData.get("batch_id") ?? ""));
  const batchError = checkCrossmallPreviewBatch(batch, "crossmall_orders", me, new Date());
  if (batchError || !batch) return json({ ok: false, error: batchError ?? "この取り込みは登録できません。" });
  // 手順2b: 指紋が記録と同じか(A-01 CH-06)。確認の画面の内容は使わず、もう一度チェックし直す
  if (batch.fileHash !== read.fileHash)
    return json({ ok: false, error: "確認したファイルと違います。もう一度『読み込む』を押してください。" });
  const planned = await plan();
  if (!planned.ok) return json({ ok: false, error: planned.error });
  // 手順3 CH-09 エラーが無い
  if (planned.counts.error > 0)
    return json({ ok: false, error: "エラーがあるため登録できません。CSVを直して読み込み直してください。" });
  if (planned.counts.add + planned.counts.change === 0) return json({ ok: false, error: "登録する内容がありません。" });

  // 手順4・5: 1つのトランザクションで登録し、記録を登録済みにする。途中で失敗したら全部取りやめる(記録は確認中のまま)
  let result: ApplyOrdersResult | "already";
  try {
    result = await transaction(
      async (tx) => {
        const locked = await lockBatch(tx, batch.id);
        if (!locked || locked.status !== "previewed") return "already" as const;
        const applied = await applyOrders(tx, planned.entries, batch.id, planned.cutoverDate);
        await markBatchApplied(
          tx,
          batch.id,
          { ...planned.counts, add: applied.added, change: applied.updated },
          planned.dataRowCount,
          me.id
        );
        return applied;
      },
      { timeoutMs: 55_000 }
    );
  } catch (e) {
    console.error("受注CSVを登録できませんでした:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "登録できませんでした。何も登録されていません。" });
  }
  if (result === "already") return json({ ok: false, error: "この取り込みはすでに登録済み・取消済みです。" });

  // 手順6: B-02 の例外注文を調べる(失敗しても受注の登録は取り消さない)
  let exceptions = "";
  try {
    const n = await detectOrderExceptions(result.orderIds);
    if (n !== null) exceptions = `,${n}`;
  } catch (e) {
    console.error("例外注文を調べられませんでした:", e instanceof Error ? e.message : e);
    exceptions = ",failed";
  }

  // 手順7: G01 へ(?imported=新規,更新[,例外の数|failed]&sales_skipped=積み上げなかった組の数)
  revalidatePath("/admin/orders");
  const salesSkipped = result.salesWarnings && result.salesWarnings.length > 0 ? `&sales_skipped=${result.salesWarnings.length}` : "";
  return json({
    ok: true,
    step: "applied",
    redirectTo: `/admin/orders?imported=${result.added},${result.updated}${exceptions}${salesSkipped}`,
  });
}
