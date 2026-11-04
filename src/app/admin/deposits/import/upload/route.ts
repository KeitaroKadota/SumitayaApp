// G02 明細の取り込みの「内容を確認する」(EV-02)・「登録する」(EV-03)。
// ファイル(4MBまで)を受け取るため、商品・受注の取り込みと同じく Server Action ではなく Route Handler にした
// (Server Action で送れる大きさは1MBまでで、広げる設定は試験段階の機能のため)。画面(DepositImportForm)から fetch で送り、結果を JSON で返す。
// 先頭で requireAccess を呼ぶ。未ログインなどのときはログイン画面などへの移動(redirect)になる。
// 取り込んだCSVのファイルそのものは保存しない(中身の行だけ。E-06 01 9章)。
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/utils/auth";
import { transaction } from "@/utils/db";
import { bankCsvFormatLabel } from "@/utils/bankCsv";
import { ENCODING_LABELS } from "@/utils/csvImport/decode";
import { readUploadedCsv } from "@/utils/csvImport/engine";
import { createPreviewBatch, getBatch, lockBatch, markBatchApplied } from "@/utils/csvImport/batches";
import { isSameOrigin } from "@/utils/crossmall/importChecks";
import { applyBankImport, getBankAccount, isImportableAccount, planBankImport, type BankImportPlan } from "@/utils/depositsServer";
import { formatDateShort, formatQuantity } from "@/utils/format";
import { IMPORT_URL, depositsUrl } from "../../depositsUrl";
import { BANK_READ_OPTIONS, READ_FAILED, checkBankPreviewBatch, type BankImportResponse } from "../importChecks";

// 1回に5,000行まで入れるため、実行時間の上限を長めにする(受注の取り込みと同じ)
export const maxDuration = 60;

// 確認の画面に出す先頭の件数(02 G02)と、エラーの文の数の上限
const PREVIEW_ROWS = 20;
const MAX_ERRORS_SHOWN = 200;
const STATUS_LABELS = { new: "新規", imported: "取込済み", duplicate: "重複（取り込まない）" } as const;

const json = (body: BankImportResponse, status = 200) => Response.json(body, { status });

export async function POST(request: Request) {
  // EV-02・EV-03 手順1
  const me = await requireAccess("receivables", IMPORT_URL);
  if (!isSameOrigin(request)) return json({ ok: false, error: "この画面から操作してください。" }, 403);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: BANK_READ_OPTIONS.fileError }, 400);
  }
  const intent = formData.get("intent");

  // EV-02 手順1: CH-02 取り込める口座
  const account = await getBankAccount(String(formData.get("account_id") ?? ""));
  if (!account || !isImportableAccount(account))
    return json({ ok: false, error: "この口座の明細は、まだ取り込めません（口座の設定で「CSVの形」を選んでください）。" });

  // 手順2: 文字コードを判定して読む(A-01 の共通の処理)
  const read = await readUploadedCsv(formData.get("file"), BANK_READ_OPTIONS);
  if (!read.ok) return json({ ok: false, error: read.error === BANK_READ_OPTIONS.fileError || read.error === BANK_READ_OPTIONS.maxRowsError ? read.error : READ_FAILED });

  const plan = async (): Promise<BankImportPlan> => {
    try {
      return await planBankImport(account, read.header, read.rows);
    } catch (e) {
      console.error("明細CSVを確認できませんでした:", e instanceof Error ? e.message : e);
      return { ok: false, error: "データの読み込みに失敗しました。もう一度お試しください。" };
    }
  };

  if (intent === "preview") {
    // 手順2〜4: 列の対応で読み、CH-03・CH-04
    const planned = await plan();
    if (!planned.ok) return json({ ok: false, error: planned.error });

    // 手順5: 取り込みの記録(previewed)の行だけ作る。整えた結果は保存しない
    let batchId: string;
    try {
      batchId = await createPreviewBatch({
        kind: "bank_transactions",
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

    const c = planned.counts;
    const okCount = planned.entries.length;
    const summary = [
      `${formatQuantity(okCount)}件（入金 ${formatQuantity(planned.depositCount)}件・出金 ${formatQuantity(planned.withdrawalCount)}件）　うち取り込み済み ${formatQuantity(c.same)}件（取り込まない）`,
    ];
    const dup = planned.entries.filter((e) => e.kind === "duplicate").length;
    if (dup > 0) summary.push(`ファイルの中で同じ明細が重なっている行 ${formatQuantity(dup)}件（1件だけ取り込みます）`);
    if (planned.skipped > 0) summary.push(`読み飛ばした行（合計の行など） ${formatQuantity(planned.skipped)}件`);
    return json({
      ok: true,
      step: "preview",
      preview: {
        batchId,
        fileName: read.fileName,
        encodingLabel: ENCODING_LABELS[read.encoding],
        formatLabel: bankCsvFormatLabel(account.csvFormat) ?? "",
        summary,
        warnings: read.hasReplacementChar ? ["文字化けしているかもしれません。書き出したときの文字コードを確かめてください。"] : [],
        errorCount: c.error,
        errors: planned.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => e.message),
        unusedColumns: planned.unusedColumns,
        newCount: c.add,
        rows: planned.entries.slice(0, PREVIEW_ROWS).map((e) => ({
          line: e.line,
          dateLabel: formatDateShort(e.transactionOn),
          description: e.description,
          deposit: e.deposit,
          withdrawal: e.withdrawal,
          balance: e.balance,
          statusLabel: STATUS_LABELS[e.kind],
        })),
      },
    });
  }

  if (intent !== "apply") return json({ ok: false, error: "もう一度『内容を確認する』を押してください。" }, 400);

  // EV-03 手順1: 取り込みの記録が確認中で、本人が作ったものか。指紋が記録と同じか(A-01 CH-06)
  const batch = await getBatch(String(formData.get("batch_id") ?? ""));
  const batchError = checkBankPreviewBatch(batch, me, new Date());
  if (batchError || !batch) return json({ ok: false, error: batchError ?? "この取り込みは登録できません。" });
  if (batch.fileHash !== read.fileHash)
    return json({ ok: false, error: "確認したファイルと違います。もう一度『内容を確認する』を押してください。" });
  // 確認の画面の内容は使わず、もう一度チェックし直す。エラーの行が1件でもあれば登録しない
  const planned = await plan();
  if (!planned.ok) return json({ ok: false, error: planned.error });
  if (planned.counts.error > 0)
    return json({ ok: false, error: "エラーがあるため登録できません。CSVを直してやり直してください。" });
  if (planned.counts.add === 0) return json({ ok: false, error: "登録する明細がありません（すべて取り込み済みです）。" });

  // 手順2〜4: 1つのトランザクションで登録し、候補を探し、記録を登録済みにする。途中で失敗したら全部取りやめる
  let result: Awaited<ReturnType<typeof applyBankImport>> | "already";
  try {
    result = await transaction(
      async (tx) => {
        const locked = await lockBatch(tx, batch.id);
        if (!locked || locked.status !== "previewed") return "already" as const;
        const applied = await applyBankImport(tx, account.id, planned.entries, batch.id);
        await markBatchApplied(
          tx,
          batch.id,
          { ...planned.counts, add: applied.added, same: planned.counts.same + (planned.counts.add - applied.added) },
          planned.dataRowCount,
          me.id
        );
        return applied;
      },
      { timeoutMs: 55_000 }
    );
  } catch (e) {
    console.error("明細CSVを登録できませんでした:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "登録できませんでした。何も登録されていません。" });
  }
  if (result === "already") return json({ ok: false, error: "この取り込みはすでに登録済み・取消済みです。" });

  // 手順5: G01 へ(取り込んだ明細のうち、いちばん新しい取引日の月を開く)
  revalidatePath("/admin/deposits");
  return json({
    ok: true,
    step: "applied",
    redirectTo: depositsUrl({
      account: account.id,
      month: result.latestOn?.slice(0, 7),
      done: "imported",
      detail: `${result.added},${result.suggested}`,
    }),
  });
}
