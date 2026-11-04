// D-03 G04 よくある質問のCSV取り込みの「内容を確認する」・「登録する」(03 EV-07)。
// 商品の取り込み(/admin/products/import/upload)と同じく、ファイル(4MBまで)を受け取るため Route Handler にした
// (Server Action は送れる大きさが1MBまで。広げる設定は試験段階の機能)。画面から fetch で送り、結果を JSON で返す。
// 先頭で requireAccess を呼ぶ。未ログインなどのときはログイン画面などへの移動(redirect)になる。
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/utils/auth";
import { transaction } from "@/utils/db";
import { ENCODING_LABELS } from "@/utils/csvImport/decode";
import { readUploadedCsv } from "@/utils/csvImport/engine";
import { createPreviewBatch, getBatch, lockBatch, markBatchApplied } from "@/utils/csvImport/batches";
import { FAQ_CSV_READ_OPTIONS, applyFaqImport, faqPreviewRows, planFaqImport } from "@/utils/faqCsv";
import { todayJST } from "@/utils/jst";
import { checkFaqPreviewBatch } from "../importChecks";
import type { FaqImportResponse } from "../importTypes";

export const maxDuration = 60;

const json = (body: FaqImportResponse, status = 200) => Response.json(body, { status });

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

const AGAIN = "もう一度『内容を確認する』を押してください。";

export async function POST(request: Request) {
  const me = await requireAccess("inquiry_settings", "/admin/inquiries/faq/import");
  if (!sameOrigin(request)) return json({ ok: false, error: "この画面から操作してください。" }, 403);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: FAQ_CSV_READ_OPTIONS.fileError }, 400);
  }
  const intent = formData.get("intent");

  // ファイルを読む(大きさ・拡張子・文字コード・行数は A-01 の共通の処理)
  const read = await readUploadedCsv(formData.get("file"), FAQ_CSV_READ_OPTIONS);
  if (!read.ok) return json({ ok: false, error: read.error });

  if (intent === "preview") {
    // 手順1: 確認(CH-05・CH-06、日本語の名前を決まった値に直す、ID があるか)
    let plan;
    try {
      plan = await planFaqImport(read.header, read.rows, todayJST());
    } catch (e) {
      console.error("よくある質問のCSVを確認できませんでした:", e instanceof Error ? e.message : e);
      return json({ ok: false, error: "データの読み込みに失敗しました。もう一度お試しください。" });
    }
    if (!plan.ok) return json({ ok: false, error: plan.error });

    // 取り込みの記録(previewed)の行だけ作る。各行の判定結果は保存しない
    let batchId: string;
    try {
      batchId = await createPreviewBatch({
        kind: "faq_entries",
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
        counts: { add: plan.counts.add, update: plan.counts.change, error: plan.counts.error },
        unusedColumns: plan.unusedColumns,
        warnings: read.hasReplacementChar
          ? ["文字化けしているかもしれません。書き出したときの文字コードを確かめてください。"]
          : [],
        rows: faqPreviewRows(plan.rows),
      },
    });
  }

  if (intent !== "apply") return json({ ok: false, error: AGAIN }, 400);

  // 登録: 取り込みの記録が確認中で、確認した本人か社長か。確認したファイルと同じか
  const batch = await getBatch(String(formData.get("batch_id") ?? ""));
  const batchError = checkFaqPreviewBatch(batch, me, new Date());
  if (batchError || !batch) return json({ ok: false, error: batchError ?? AGAIN });
  if (batch.fileHash !== read.fileHash) return json({ ok: false, error: `確認したファイルと違います。${AGAIN}` });

  // 確認の画面の内容は使わず、もう一度チェックして決め直す
  const plan = await planFaqImport(read.header, read.rows, todayJST());
  if (!plan.ok) return json({ ok: false, error: plan.error });
  if (plan.counts.add + plan.counts.change === 0) return json({ ok: false, error: "登録する内容がありません。" });

  // 手順2: 1つのトランザクションで入れる・更新する。1件でも失敗したら全部やめる(エラーの行は登録しない)
  let result: { added: number; updated: number } | "already";
  try {
    result = await transaction(
      async (tx) => {
        const locked = await lockBatch(tx, batch.id);
        if (!locked || locked.status !== "previewed") return "already" as const;
        const applied = await applyFaqImport(tx, plan.rows, me.id);
        await markBatchApplied(
          tx,
          batch.id,
          { ...plan.counts, add: applied.added, change: applied.updated, skip: plan.counts.error },
          plan.dataRowCount,
          me.id
        );
        return applied;
      },
      { timeoutMs: 55_000 }
    );
  } catch (e) {
    console.error("よくある質問のCSVを登録できませんでした:", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "登録できませんでした。何も登録されていません。" });
  }
  if (result === "already") return json({ ok: false, error: "この取り込みはすでに登録済み・取消済みです。" });

  // 手順3: 一覧へ戻し、「◯件を登録しました」
  revalidatePath("/admin/inquiries/faq");
  return json({ ok: true, step: "applied", redirectTo: `/admin/inquiries/faq?imported=${result.added},${result.updated}` });
}
