import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { formatDate, formatDateShort, formatDateTime, formatYen } from "@/utils/format";
import { listActiveSuppliers } from "@/utils/masters";
import {
  DUE_SOURCES,
  LINE_MATCH_STATUSES,
  MATCH_RESULTS,
  PAYABLE_LIMITS,
  PAYABLE_STATUSES,
  formatInvoiceQuantity,
  scheduleBlockers,
  signedYen,
  type InvoiceLine,
  type Reason,
} from "@/utils/payables";
import { assessPayable, getPayable, isPayableId, payableUrl, type Assessment } from "@/utils/payablesServer";
import { getSignedUrls } from "@/utils/storage";
import { AiDraft } from "@/components/AiDraft";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { TextInput } from "@/components/TextInput";
import {
  approveReceivedInvoiceDifference,
  cancelReceivedInvoice,
  rereadReceivedInvoice,
  saveReceivedInvoice,
} from "../actions";
import { LINE_MATCH_TONES, LIST_URL, MATCH_TONES, STATUS_TONES } from "../payablesView";
import { FileViewer } from "./FileViewer";
import { ReviewForm, type ReviewLine } from "./ReviewForm";

// 「読み取り直す」は AI の読み取りを待つので、操作の時間の上限を長めにする
export const maxDuration = 60;

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

const DONE_MESSAGES: Record<string, string> = {
  registered: "登録しました。",
  saved: "保存しました。",
  reread: "読み取り直しました。",
  approved: "差異を認めました。",
};
const ERROR_MESSAGES: Record<string, string> = {
  conflict: "ほかの人がこの請求書を更新しました。画面を開き直してください。",
  status: "この請求書は、今の状態ではこの操作ができません。",
  no_file: "請求書のファイルが無いため、読み取れません。",
  save: "保存できませんでした。時間をおいてもう一度お試しください。",
  note: "差異を認める理由を入力してください。",
  note_long: `差異を認める理由は${PAYABLE_LIMITS.approveNote}文字以内で入力してください。`,
  memo_full: `確認のメモが${PAYABLE_LIMITS.note.toLocaleString("ja-JP")}文字を超えるため、足せませんでした。メモを短くしてから押してください。`,
  cancel_reason: "取り消す理由を入力してください。",
  cancel_reason_long: `取り消す理由は${PAYABLE_LIMITS.cancelReason}文字以内で入力してください。`,
  schedule: "支払予定にできませんでした。下の「支払予定にするには」の点を直してください。",
};
const AI_FAIL_MESSAGES: Record<string, string> = {
  failed: "AIの案を作れませんでした。手で入力してください。",
  quota: "AIの案を作れませんでした（本日のAIの利用回数に達しました）。手で入力してください。",
  disabled: "AIの案を作れませんでした（AIの設定がありません）。手で入力してください。",
};

const val = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

// 明細の突合の表示(02 G03 の「突合」の列)
const lineMatchView = (l: InvoiceLine, a: Assessment | null): ReviewLine["match"] => {
  if (!a) return null;
  const m = a.match.lines[l.lineNo - 1] ?? null;
  const status = m?.matchStatus ?? l.matchStatus;
  const hasData = a.match.matchResult === "matched" || a.match.matchResult === "difference";
  let detail: string | null = null;
  if (m?.matchStatus === "price_diff" && m.orderUnitPrice !== null && m.diffAmount !== null)
    detail = `発注の単価 ${formatYen(m.orderUnitPrice)}（差 ${signedYen(m.diffAmount)}）`;
  else if (m?.matchStatus === "amount_diff" && m.slipAmount !== null && m.diffAmount !== null)
    detail = `納品書 ${formatYen(m.slipAmount, "excluded")}（差 ${signedYen(m.diffAmount)}）`;
  else if (status === "not_found" && !hasData) detail = "照合できる検収データがありません";
  return {
    label: status === "not_found" && !hasData ? "データなし" : LINE_MATCH_STATUSES[status],
    tone: status === "not_found" && !hasData ? "warning" : LINE_MATCH_TONES[status],
    detail,
    // 差異を認められるのは、検収のデータがあって差異がある行だけ(人が認めた行・一致の行は除く)
    canApprove: hasData && (status === "amount_diff" || status === "price_diff" || status === "not_found"),
  };
};

// G03 請求書の確認・修正(E-04 03 EV-05)
export default async function PayableDetailPage({ params, searchParams }: PageProps<"/admin/payables/[id]">) {
  const { id } = await params;
  await requireAccess("payables", payableUrl(id));
  const query = await searchParams;

  // 手順1
  const loaded = isPayableId(id) ? await getPayable(id) : null;
  if (!loaded) redirect(`${LIST_URL}?error=not_found`);
  const { invoice, lines } = loaded;

  // 手順2: ファイルの期限付きURL(10分)
  const urls = invoice.fileId ? await getSignedUrls([invoice.fileId]) : new Map<string, string>();
  const fileUrl = invoice.fileId ? (urls.get(invoice.fileId) ?? null) : null;

  // 手順3・4: 突合を計算し直し、確認が必要な点を作る(保存はしない)
  let assessment: Assessment | null = null;
  try {
    assessment = await assessPayable(invoice, lines, "other");
  } catch (e) {
    console.error("請求書の判定を表示できませんでした:", e instanceof Error ? e.message : e);
  }
  const reasons: Reason[] = invoice.status === "cancelled" ? [] : (assessment?.reasons ?? []);
  const blockers = scheduleBlockers(invoice, invoice.status, reasons, invoice.reviewNote);
  const readOnly = invoice.status === "cancelled";
  const reviewed = invoice.reviewedAt !== null;

  const suppliers = (await listActiveSuppliers()).map((s) => ({ id: s.id, name: s.name }));
  if (invoice.supplierId && !suppliers.some((s) => s.id === invoice.supplierId))
    suppliers.unshift({ id: invoice.supplierId, name: `${invoice.supplierName ?? "（仕入先）"}（取引停止）` });

  const done = DONE_MESSAGES[str(query.done)];
  const error = ERROR_MESSAGES[str(query.error)];
  const aiFail = AI_FAIL_MESSAGES[str(query.ai)];

  // 支払予定日の横の文(「（請求書から）」と、休日で前倒ししたとき)
  const due = assessment?.due;
  const dueNote = [
    invoice.dueDateSource ? `（${DUE_SOURCES[invoice.dueDateSource]}）` : "",
    due?.shiftedFrom && due.dueOn ? `（休日のため ${formatDateShort(due.dueOn)}に前倒し）` : "",
  ].join("");

  // 注意の印(確認待ちの理由にはしない)
  const notices: string[] = [];
  if (!invoice.registrationNo) notices.push("⚠ 登録番号なし（インボイスでない可能性）");
  if (invoice.amountDue > invoice.purchaseTotal) notices.push("前回の残り（繰越）が含まれています");
  if (!reviewed && assessment?.ai) notices.push(...assessment.ai.notes);

  const initialValues: Record<string, string> = {
    kind: invoice.kind,
    supplier_id: val(invoice.supplierId),
    payee_name: val(invoice.payeeName),
    registration_no: val(invoice.registrationNo),
    invoice_no: val(invoice.invoiceNo),
    invoice_date: val(invoice.invoiceDate),
    period_start: val(invoice.periodStart),
    period_end: val(invoice.periodEnd),
    previous_balance: val(invoice.previousBalance),
    payment_received: val(invoice.paymentReceived),
    carried_over: val(invoice.carriedOver),
    subtotal_10: val(invoice.subtotal10),
    tax_10: val(invoice.tax10),
    subtotal_8: val(invoice.subtotal8),
    tax_8: val(invoice.tax8),
    subtotal_exempt: val(invoice.subtotalExempt),
    amount_due: val(invoice.amountDue),
    due_on: val(invoice.dueOn),
    payment_method: val(invoice.paymentMethod),
    transfer_to: val(invoice.transferTo),
    review_note: val(invoice.reviewNote),
  };
  const initialLines: ReviewLine[] = lines.map((l) => ({
    key: l.id ?? `line-${l.lineNo}`,
    id: l.id,
    date: val(l.lineDate),
    slip: val(l.slipNo),
    desc: l.description,
    code: val(l.itemCode),
    qty: l.quantity === null ? "" : formatInvoiceQuantity(l.quantity).replace(/,/g, ""),
    price: val(l.unitPrice),
    amount: val(l.amount),
    rate: String(l.taxRate),
    match: lineMatchView(l, assessment),
  }));
  const slipOnly = (assessment?.match.slipOnly ?? []).map((s) => ({
    id: s.id,
    detail: `納品書 ${[formatDateShort(s.deliveryDate), s.slipNo].filter(Boolean).join(" ")} 検収済み ${formatYen(s.total, "included")}`,
  }));
  const m = assessment?.match;
  const totals =
    m && m.matchedTotal !== null && m.differenceAmount !== null
      ? `請求のお買上げ額 ${formatYen(invoice.purchaseTotal)} / 検収の合計 ${formatYen(m.matchedTotal)} / 差 ${signedYen(m.differenceAmount)}`
      : null;
  const showSchedule = invoice.status === "reading" || invoice.status === "needs_review";

  const form = (
    <ReviewForm
      key={invoice.version}
      action={saveReceivedInvoice.bind(null, invoice.id)}
      approveAction={approveReceivedInvoiceDifference.bind(null, invoice.id)}
      initialValues={initialValues}
      initialLines={initialLines}
      slipOnly={slipOnly}
      suppliers={suppliers}
      flags={!reviewed && assessment?.ai ? assessment.ai.flags : []}
      version={invoice.version}
      readOnly={readOnly}
      dueNote={dueNote}
      canSchedule={blockers.length === 0}
      blockers={blockers}
      showSchedule={showSchedule}
      totals={totals}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href={LIST_URL} label="一覧へ" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">請求書の確認</h1>
        <span className={invoice.status === "cancelled" ? "line-through" : ""}>
          <Badge tone={STATUS_TONES[invoice.status]}>{PAYABLE_STATUSES[invoice.status]}</Badge>
        </span>
        {assessment && <Badge tone={MATCH_TONES[assessment.match.matchResult]}>突合: {MATCH_RESULTS[assessment.match.matchResult]}</Badge>}
      </div>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {aiFail && <Alert tone="warning">{aiFail}</Alert>}
      {!assessment && <Alert tone="warning">突合・支払予定日の計算を表示できませんでした。時間をおいて開き直してください。</Alert>}
      {invoice.status === "cancelled" && (
        <Alert tone="info">
          この請求書は取り消しました。理由: {invoice.cancelReason}
        </Alert>
      )}

      {reasons.length > 0 && (
        <Alert tone="warning">
          <p className="font-bold">確認が必要な点（{reasons.length}件）</p>
          <ul className="mt-1 list-disc pl-5">
            {reasons.map((r, i) => (
              <li key={`${r.code}-${i}`}>
                {r.message}
                {r.href && (
                  <a href={r.href} className="ml-1 font-bold text-primary hover:underline">
                    その請求書を開く
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {notices.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-ink-muted">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">請求書の画像</h2>
          {invoice.fileId ? (
            <FileViewer url={fileUrl} contentType={invoice.fileContentType} name={invoice.fileName} />
          ) : (
            <p className="rounded-md border border-line bg-canvas p-4 text-sm text-ink-muted">ファイルはありません（手入力）。</p>
          )}
          {invoice.fileId && showSchedule && (
            <form action={rereadReceivedInvoice.bind(null, invoice.id)}>
              <input type="hidden" name="version" value={invoice.version} />
              <ConfirmSubmitButton
                variant="secondary"
                confirmMessage="この内容は読み取り直した結果で置き換わります。よいですか？"
                pendingText="読み取り中…"
              >
                読み取り直す
              </ConfirmSubmitButton>
            </form>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          {!reviewed && invoice.aiRaw !== null && invoice.status !== "cancelled" ? (
            <AiDraft title="読み取り結果" createdAt={invoice.createdAt}>
              {form}
            </AiDraft>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
              {reviewed && invoice.reviewedAt && (
                <p>
                  <Badge tone="success">
                    確認済み（{invoice.reviewedByName ?? "−"}・{formatDateTime(invoice.reviewedAt)}）
                  </Badge>
                </p>
              )}
              {form}
            </div>
          )}
          <p className="text-xs text-ink-muted">
            登録: {formatDate(invoice.createdAt)}
            {invoice.fileName ? `　ファイル: ${invoice.fileName}` : ""}
          </p>
        </section>
      </div>

      {invoice.status !== "cancelled" && (
        <form action={cancelReceivedInvoice.bind(null, invoice.id)} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
          <input type="hidden" name="version" value={invoice.version} />
          <Field id="cancel_reason" label="取り消す理由" required>
            <TextInput
              id="cancel_reason"
              name="cancel_reason"
              required
              maxLength={PAYABLE_LIMITS.cancelReason}
              placeholder="例: 二重に登録したため"
              className="w-80"
            />
          </Field>
          <ConfirmSubmitButton confirmMessage="この請求書を取り消してよいですか？支払予定から外れます。" pendingText="取消中…">
            取り消す
          </ConfirmSubmitButton>
        </form>
      )}
    </div>
  );
}
