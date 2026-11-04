"use server";

// 請求書の作成・発行の操作(E-05 03 EV-05・EV-06・EV-08・EV-10〜EV-12)。機能キー receivables(社長・経理)。
// 操作はエラーを投げずに画面へ文で返す(入力のある操作は FormState、ボタンだけの操作は ?error= で G02 に戻す)。
// 金額・税額は画面の値を使わず、サーバーで計算し直す(CH-06)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { INVOICE_LIMITS, parseInvoiceForm } from "@/utils/invoices";
import {
  INVOICES_URL,
  createCorrectionDraft,
  currentRounding,
  deleteDraft,
  getCompanySettings,
  getInvoice,
  invoicePrintUrl,
  invoiceUrl,
  isInvoiceId,
  issueInvoice,
  listInvoiceCustomers,
  saveDraft,
  voidInvoice,
} from "@/utils/invoicesServer";
import { todayJST } from "@/utils/jst";
import { formText } from "@/utils/textNormalize";

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CONFLICT = "ほかの人がこの請求書を更新しました。画面を開き直してください。";
const ISSUED_READONLY = "発行済みの請求書は直せません。直すときは「訂正する」を使ってください。";

// 「印刷して確認する」のときは画面を移さずに、印刷のページのURLを返す(画面が新しいタブで開く。EV-06)
export type InvoiceFormState = FormState & { printUrl?: string; savedId?: string; version?: string; nonce?: number };

const refresh = (id?: string) => {
  revalidatePath(INVOICES_URL);
  if (id) revalidatePath(invoiceUrl(id));
};

// ---- EV-05 「保存する」・EV-06 「印刷して確認する」・EV-08 「発行する」(intent = save・print・issue) ----

export async function saveInvoice(id: string | null, _prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const me = await requireAccess("receivables", id ? invoiceUrl(id) : `${INVOICES_URL}/new`);
  const values = formValues(formData);
  const intent = formText(formData, "intent");
  if (id && !isInvoiceId(id)) return { errors: {}, formError: "この請求書は見つかりません。", values };

  // 手順1・2: CH-13 入力値(下書きの保存では必須の欠けは止めない)
  const parsed = parseInvoiceForm(values);
  if (!parsed.ok) return { errors: parsed.errors, formError: errorSummary(parsed.errors), values };
  const { input } = parsed;
  if (input.customerId) {
    const customers = await listInvoiceCustomers(input.customerId);
    if (!customers.some((c) => c.id === input.customerId)) {
      const errors = { customer_id: "取引先を選び直してください。" };
      return { errors, formError: errorSummary(errors), values };
    }
  }

  // 手順3・4: 0.1 で金額を計算して保存する(CH-10・CH-14 はトランザクションの中で確かめる)
  const company = await getCompanySettings().catch(() => null);
  let savedId: string;
  try {
    const result = await saveDraft(id, formText(formData, "version"), input, currentRounding(company), me.id);
    if (!result.ok) {
      const message =
        result.reason === "conflict" ? CONFLICT : result.reason === "status" ? ISSUED_READONLY : "この請求書は見つかりません。";
      return { errors: {}, formError: message, values };
    }
    savedId = result.id;
  } catch (e) {
    console.error("請求書を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  refresh(savedId);

  // EV-06: 保存してから、印刷のページを新しいタブで開く(画面の部品が開く)
  if (intent === "print") {
    const fresh = await getInvoice(savedId);
    return {
      errors: {},
      formError: null,
      values,
      printUrl: invoicePrintUrl([savedId]),
      savedId,
      version: fresh?.invoice.version,
      nonce: Date.now(),
    };
  }
  if (intent !== "issue") redirect(`${invoiceUrl(savedId)}?done=saved`);

  // EV-08 手順2・3: CH-09 を確かめ、番号を付けて発行する(満たしていなければ下書きのまま、理由を G02 に出す)
  const fresh = await getInvoice(savedId);
  if (!fresh) redirect(`${INVOICES_URL}?error=not_found`);
  let issued: Awaited<ReturnType<typeof issueInvoice>>;
  try {
    issued = await issueInvoice(savedId, fresh.invoice.version, todayJST(), me.id);
  } catch (e) {
    console.error("請求書を発行できませんでした:", e instanceof Error ? e.message : e);
    redirect(`${invoiceUrl(savedId)}?done=saved&error=issue_failed`);
  }
  if (!issued.ok) {
    const code =
      issued.reason === "blocked"
        ? "issue_blocked"
        : issued.reason === "replace_blocked"
          ? "replace_blocked"
          : issued.reason === "no_limit"
            ? "no_limit"
            : issued.reason === "conflict"
              ? "conflict"
              : "issue_failed";
    redirect(`${invoiceUrl(savedId)}?done=saved&error=${code}`);
  }
  if (fresh.invoice.replacesInvoiceId) refresh(fresh.invoice.replacesInvoiceId);
  refresh(savedId);
  // 手順5
  redirect(`${invoiceUrl(savedId)}?done=issued`);
}

// ---- EV-10 「訂正する」 ----

export async function correctInvoice(id: string): Promise<void> {
  const me = await requireAccess("receivables", invoiceUrl(id));
  if (!isInvoiceId(id)) redirect(`${INVOICES_URL}?error=not_found`);
  let result: Awaited<ReturnType<typeof createCorrectionDraft>>;
  try {
    result = await createCorrectionDraft(id, me.id);
  } catch (e) {
    console.error("訂正の下書きを作れませんでした:", e instanceof Error ? e.message : e);
    redirect(`${invoiceUrl(id)}?error=save`);
  }
  if (!result.ok) redirect(result.reason === "not_found" ? `${INVOICES_URL}?error=not_found` : `${invoiceUrl(id)}?error=${result.reason}`);
  refresh(result.id);
  redirect(`${invoiceUrl(result.id)}?done=correction`);
}

// ---- EV-11 「取り消す」 ----

export async function voidInvoiceAction(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("receivables", invoiceUrl(id));
  if (!isInvoiceId(id)) redirect(`${INVOICES_URL}?error=not_found`);
  // 手順1: 理由(必須・200文字まで。CH-11)
  const reason = formText(formData, "void_reason");
  if (!reason) redirect(`${invoiceUrl(id)}?error=void_reason`);
  if (reason.length > INVOICE_LIMITS.voidReason) redirect(`${invoiceUrl(id)}?error=void_reason_long`);

  // 手順2・3: CH-11・CH-14
  let result: Awaited<ReturnType<typeof voidInvoice>>;
  try {
    result = await voidInvoice(id, formText(formData, "version"), reason, me.id);
  } catch (e) {
    console.error("請求書を取り消せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${invoiceUrl(id)}?error=save`);
  }
  if (!result.ok) redirect(result.reason === "not_found" ? `${INVOICES_URL}?error=not_found` : `${invoiceUrl(id)}?error=${result.reason}`);
  refresh(id);
  // 手順4
  redirect(`${INVOICES_URL}?done=voided`);
}

// ---- EV-12 「削除する」(下書きだけ) ----

export async function deleteInvoiceDraft(id: string): Promise<void> {
  await requireAccess("receivables", invoiceUrl(id));
  if (!isInvoiceId(id)) redirect(`${INVOICES_URL}?error=not_found`);
  let ok = false;
  try {
    ok = await deleteDraft(id);
  } catch (e) {
    console.error("下書きを削除できませんでした:", e instanceof Error ? e.message : e);
    redirect(`${invoiceUrl(id)}?error=save`);
  }
  if (!ok) redirect(`${invoiceUrl(id)}?error=status`);
  refresh();
  redirect(`${INVOICES_URL}?done=deleted`);
}
