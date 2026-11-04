"use server";

// 受け取った請求書の操作(E-04 03 EV-03・EV-04・EV-06〜EV-10)。機能キー payables(社長・経理)。
// 操作はエラーを投げずに画面へ文で返す(入力のある操作は FormState、ボタンだけの操作は ?error= で G03 に戻す)。
// AIは読み取りだけ。検算・突合・支払予定日は evaluateReceivedInvoice(計算)で出す。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { formatDateShort } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { listActiveSuppliers } from "@/utils/masters";
import {
  LINE_MATCH_STATUSES,
  PAYABLE_LIMITS,
  appendReviewNote,
  approveNoteLine,
  checkApproveNote,
  isPayableKind,
  normalizeAiInvoice,
  parseInvoiceForm,
  scheduleBlockers,
  signedYen,
  type InvoiceLineInput,
} from "@/utils/payables";
import {
  applyAiRead,
  approveLineDifference,
  assessPayable,
  cancelInvoice,
  evaluateReceivedInvoice,
  getPayable,
  insertReadingInvoice,
  isCurrentVersion,
  isFileUsable,
  isPayableId,
  markScheduled,
  payableUrl,
  readInvoiceWithAi,
  saveInvoiceInput,
} from "@/utils/payablesServer";
import { deleteFile, getStoredFile } from "@/utils/storage";
import { formText } from "@/utils/textNormalize";
import { LIST_URL, SCHEDULE_URL } from "./payablesView";

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CONFLICT = "ほかの人がこの請求書を更新しました。画面を開き直してください。";
const NOT_FOUND = "この請求書は見つかりません。";

const refresh = (id?: string) => {
  revalidatePath(LIST_URL);
  revalidatePath(SCHEDULE_URL);
  if (id) revalidatePath(payableUrl(id));
};

// AIで読めなかった理由(?ai=。G03 に「AIの案を作れませんでした。手で入力してください。」を出す)
const aiFailCode = (reason: string): string => (reason === "quota" || reason === "disabled" ? reason : "failed");

// ---- EV-03 「登録して読み取る」・EV-04 「AIを使わずに手で入力する」(mode = ai・manual) ----

export async function registerReceivedInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("payables", "/admin/payables/new");
  const values = formValues(formData);
  const mode = formText(formData, "mode") === "manual" ? "manual" : "ai";

  // 手順1: 種類・仕入先(任意)・ファイル(AIのときは必須)
  const errors: Record<string, string> = {};
  const kind = formText(formData, "kind");
  if (!isPayableKind(kind)) errors.kind = "種類を選んでください。";
  const supplierId = formText(formData, "supplier_id");
  const suppliers = await listActiveSuppliers();
  const supplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
  if (supplierId && !supplier) errors.supplier_id = "仕入先を選び直してください。";
  const fileId = formText(formData, "file_id");
  if (mode === "ai" && !fileId) errors.file = "請求書の写真かPDFを選んでください。";
  if (Object.keys(errors).length > 0 || !isPayableKind(kind)) return { errors, formError: errorSummary(errors), values };

  // 手順2・3: 保存したファイル(CH-02 はファイルの送り先で確かめ済み)が、本人が上げた請求書のファイルで、まだ使われていない
  if (fileId) {
    const file = await getStoredFile(fileId);
    if (!file || !(await isFileUsable(fileId, me.id)))
      return { errors: { file: "このファイルは使えません。もう一度選んでください。" }, formError: "ファイルを選び直してください。", values };
  }

  // 手順5: 読み取り中で登録する(金額はすべて0、請求元の名前は仕入先の名前か空)
  let id: string;
  try {
    id = await insertReadingInvoice({
      kind,
      supplierId: supplier?.id ?? null,
      payeeName: supplier?.name ?? null,
      fileId: fileId || null,
      by: me.id,
    });
  } catch (e) {
    console.error("請求書を登録できませんでした:", e instanceof Error ? e.message : e);
    if (fileId) await deleteFile(fileId, me.id).catch(() => {});
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  // 手順6・7: AIで読み取る(EV-04 は呼ばない)
  let aiFail: string | null = mode === "manual" ? null : "failed";
  if (mode === "ai" && fileId) {
    const ai = await readInvoiceWithAi(id, fileId, supplier?.id ?? null, me.id);
    if (ai.ok) {
      const normalized = normalizeAiInvoice(ai.data);
      if (normalized) {
        try {
          await applyAiRead(id, normalized, ai.data, ai.requestId, me.id);
          aiFail = null;
        } catch (e) {
          console.error("読み取った内容を保存できませんでした:", e instanceof Error ? e.message : e);
        }
      }
    } else {
      aiFail = aiFailCode(ai.reason);
    }
  }

  // 手順8: 判定(読み取れなかったときは「読み取りできなかった」の理由で確認待ち)
  try {
    await evaluateReceivedInvoice(id, "read", me.id);
  } catch (e) {
    console.error("請求書を判定できませんでした:", e instanceof Error ? e.message : e);
  }

  // 手順9
  refresh(id);
  const params = new URLSearchParams({ done: "registered" });
  if (aiFail) params.set("ai", aiFail);
  if (mode === "manual") params.set("manual", "1");
  redirect(`${payableUrl(id)}?${params.toString()}`);
}

// ---- EV-07 「保存する」・EV-09 「確認して支払予定にする」(intent = save・schedule) ----

export async function saveReceivedInvoice(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("payables", payableUrl(id));
  const values = formValues(formData);
  const loaded = isPayableId(id) ? await getPayable(id) : null;
  if (!loaded) return { errors: {}, formError: NOT_FOUND, values };
  const { invoice, lines: currentLines } = loaded;
  if (invoice.status === "cancelled") return { errors: {}, formError: "取り消した請求書は直せません。", values };

  // 手順1・2: CH-17 入力値。お買上げ額は画面の値を使わず、税率ごとの金額から計算する(parseInvoiceForm の中)
  const parsed = parseInvoiceForm(values, { dueOn: invoice.dueOn, dueDateSource: invoice.dueDateSource });
  if (!parsed.ok) return { errors: parsed.errors, formError: errorSummary(parsed.errors), values };
  const { header } = parsed;
  if (header.supplierId && header.supplierId !== invoice.supplierId) {
    const suppliers = await listActiveSuppliers();
    if (!suppliers.some((s) => s.id === header.supplierId)) {
      const e = { supplier_id: "仕入先を選び直してください。" };
      return { errors: e, formError: errorSummary(e), values };
    }
  }

  // 人が差異を認めた行は、日付・伝票番号・金額・単価を変えていなければ認めたままにする
  const lines = parsed.lines.map((l): InvoiceLineInput & { manualOk: boolean } => {
    const before = currentLines.find((c) => c.id === l.originalId);
    const same =
      before &&
      before.matchStatus === "manual_ok" &&
      before.lineDate === l.lineDate &&
      before.slipNo === l.slipNo &&
      before.amount === l.amount &&
      before.unitPrice === l.unitPrice;
    return { ...l, manualOk: Boolean(same) };
  });

  // 手順3: CH-18 ほかの人の更新を見て、請求書を更新し明細を入れ替える(1つのトランザクション)
  let saved = false;
  try {
    saved = await saveInvoiceInput(invoice.id, formText(formData, "version"), header, lines, parsed.reviewNote, me.id);
  } catch (e) {
    console.error("請求書を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  if (!saved) return { errors: {}, formError: CONFLICT, values };

  // 手順4: 判定
  let evaluated: Awaited<ReturnType<typeof evaluateReceivedInvoice>> = null;
  try {
    evaluated = await evaluateReceivedInvoice(invoice.id, "save", me.id);
  } catch (e) {
    console.error("請求書を判定できませんでした:", e instanceof Error ? e.message : e);
  }
  refresh(invoice.id);

  if (formData.get("intent") !== "schedule") redirect(`${payableUrl(invoice.id)}?done=saved`);

  // EV-09 手順2: CH-15(状態は押したときのもので見る)
  const fresh = await getPayable(invoice.id);
  if (!fresh || !evaluated) redirect(`${payableUrl(invoice.id)}?done=saved&error=schedule`);
  const blockers = scheduleBlockers(fresh.invoice, invoice.status, evaluated.assessment.reasons, fresh.invoice.reviewNote);
  if (blockers.length > 0) redirect(`${payableUrl(invoice.id)}?done=saved&error=schedule`);

  // 手順3〜5
  try {
    await markScheduled(invoice.id, me.id);
  } catch (e) {
    console.error("支払予定にできませんでした:", e instanceof Error ? e.message : e);
    redirect(`${payableUrl(invoice.id)}?done=saved&error=save`);
  }
  refresh(invoice.id);
  redirect(`${LIST_URL}?done=scheduled`);
}

// ---- EV-06 「読み取り直す」 ----

export async function rereadReceivedInvoice(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("payables", payableUrl(id));
  const loaded = isPayableId(id) ? await getPayable(id) : null;
  if (!loaded) redirect(`${LIST_URL}?error=not_found`);
  const { invoice } = loaded;
  // 手順2: CH-18、状態が読み取り中・確認待ち
  if (!(await isCurrentVersion(invoice.id, formText(formData, "version")))) redirect(`${payableUrl(invoice.id)}?error=conflict`);
  if (invoice.status !== "reading" && invoice.status !== "needs_review") redirect(`${payableUrl(invoice.id)}?error=status`);
  if (!invoice.fileId) redirect(`${payableUrl(invoice.id)}?error=no_file`);

  // 手順3: EV-03 の手順6〜8。読めなかったときは前の値のまま
  const ai = await readInvoiceWithAi(invoice.id, invoice.fileId, invoice.supplierId, me.id);
  if (!ai.ok) redirect(`${payableUrl(invoice.id)}?ai=${aiFailCode(ai.reason)}`);
  const normalized = normalizeAiInvoice(ai.data);
  if (!normalized) redirect(`${payableUrl(invoice.id)}?ai=failed`);
  try {
    await applyAiRead(invoice.id, normalized, ai.data, ai.requestId, me.id);
    await evaluateReceivedInvoice(invoice.id, "read", me.id);
  } catch (e) {
    console.error("読み取り直した内容を保存できませんでした:", e instanceof Error ? e.message : e);
    redirect(`${payableUrl(invoice.id)}?error=save`);
  }
  refresh(invoice.id);
  redirect(`${payableUrl(invoice.id)}?done=reread`);
}

// ---- EV-08 「差異を認める」(明細の行 line_id、または「検収のみ」の納品書 slip_id) ----

export async function approveReceivedInvoiceDifference(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("payables", payableUrl(id));
  const loaded = isPayableId(id) ? await getPayable(id) : null;
  if (!loaded) redirect(`${LIST_URL}?error=not_found`);
  const { invoice, lines } = loaded;
  if (invoice.status === "cancelled") redirect(`${payableUrl(invoice.id)}?error=status`);

  // 手順2: CH-14・CH-18
  const note = formText(formData, "note");
  if (checkApproveNote(note)) redirect(`${payableUrl(invoice.id)}?error=${note ? "note_long" : "note"}`);
  const version = formText(formData, "version");
  if (!(await isCurrentVersion(invoice.id, version))) redirect(`${payableUrl(invoice.id)}?error=conflict`);

  // 手順3: 認める相手の文(「10/12（月） A-007 単価差 +2,000円（税抜）」)
  const lineId = formText(formData, "line_id");
  const slipId = formText(formData, "slip_id");
  let target: string;
  if (lineId) {
    const line = lines.find((l) => l.id === lineId);
    if (!line || line.matchStatus === "manual_ok" || line.matchStatus === "matched" || line.matchStatus === "not_applicable")
      redirect(`${payableUrl(invoice.id)}?error=status`);
    const label = line.matchStatus === "price_diff" ? "単価差" : line.matchStatus === "amount_diff" ? "金額差" : LINE_MATCH_STATUSES[line.matchStatus];
    target = [
      line.lineDate ? formatDateShort(line.lineDate) : `${line.lineNo}行目`,
      line.slipNo,
      label,
      line.diffAmount !== null ? `${signedYen(line.diffAmount)}（税抜）` : "",
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    // 「検収のみ」の行: 請求書全体のメモにだけ残す(納品書は結び付けない)
    const a = await assessPayable(invoice, lines, "other");
    const slip = a.match.slipOnly.find((s) => s.id === slipId);
    if (!slip) redirect(`${payableUrl(invoice.id)}?error=status`);
    target = `検収のみ ${[formatDateShort(slip.deliveryDate), slip.slipNo].filter(Boolean).join(" ")}`;
  }
  const nextNote = appendReviewNote(invoice.reviewNote, approveNoteLine(todayJST(), me.lastName, target, note));
  if (nextNote === null) redirect(`${payableUrl(invoice.id)}?error=memo_full`);

  let ok = false;
  try {
    ok = await approveLineDifference(invoice.id, version, lineId || null, nextNote, me.id);
    // 手順4
    if (ok) await evaluateReceivedInvoice(invoice.id, "other", me.id);
  } catch (e) {
    console.error("差異を認められませんでした:", e instanceof Error ? e.message : e);
    redirect(`${payableUrl(invoice.id)}?error=save`);
  }
  if (!ok) redirect(`${payableUrl(invoice.id)}?error=conflict`);
  refresh(invoice.id);
  redirect(`${payableUrl(invoice.id)}?done=approved`);
}

// ---- EV-10 「取り消す」 ----

export async function cancelReceivedInvoice(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("payables", payableUrl(id));
  const loaded = isPayableId(id) ? await getPayable(id) : null;
  if (!loaded) redirect(`${LIST_URL}?error=not_found`);
  const { invoice } = loaded;
  if (invoice.status === "cancelled") redirect(`${payableUrl(invoice.id)}?error=status`);

  // 手順1: 理由(必須)
  const reason = formText(formData, "cancel_reason");
  if (!reason) redirect(`${payableUrl(invoice.id)}?error=cancel_reason`);
  if (reason.length > PAYABLE_LIMITS.cancelReason) redirect(`${payableUrl(invoice.id)}?error=cancel_reason_long`);

  // 手順2〜4: CH-18 を見て取消にし、納品書との結び付きを外し、タスクを完了にする(ファイルは消さない)
  let ok = false;
  try {
    ok = await cancelInvoice(invoice.id, formText(formData, "version"), reason, me.id);
  } catch (e) {
    console.error("請求書を取り消せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${payableUrl(invoice.id)}?error=save`);
  }
  if (!ok) redirect(`${payableUrl(invoice.id)}?error=conflict`);
  refresh(invoice.id);
  redirect(`${LIST_URL}?done=cancelled`);
}
