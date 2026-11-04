// G02 経費の申請(確認・修正・申請。スマホ。E-07 03 EV-04)。機能キー expenses_apply(全員)。本人の経費だけ(CH-02)。
// 状態に合わせて出し分ける(02 G02 の①〜④): 下書き・差し戻しは入力欄、承認待ち・承認済み・取り下げは読むだけ。
import { redirect } from "next/navigation";
import { fullName, requireAccess } from "@/utils/auth";
import { EXPENSE_STATUSES, duplicateMessage, normalizeAiReceipt } from "@/utils/expenseClaims";
import {
  EXPENSES_URL,
  expenseUrl,
  findDuplicate,
  getOwnExpense,
  listAccountTitles,
  type Expense,
} from "@/utils/expenseClaimsServer";
import { formatDateShort, formatDateTime } from "@/utils/format";
import { getSignedUrls, isStorageConfigured } from "@/utils/storage";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { BackLink } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { deleteExpenseDraft, retakeReceipt, saveExpense, withdrawExpense } from "../actions";
import { ExpenseDetail } from "../ExpenseDetail";
import { EXPENSE_STATUS_TONES } from "../expensesView";
import { ReceiptCapture } from "../ReceiptCapture";
import { ExpenseForm } from "./ExpenseForm";

// 「撮り直す」は AI の読み取り(30秒で打ち切り)を待つので、操作の時間の上限を長めにする
export const maxDuration = 60;

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

const DONE_MESSAGES: Record<string, string> = {
  reread: "領収書を撮り直して、読み取りました。",
  to_draft: "申請を取り下げて、下書きに戻しました。",
};
const ERROR_MESSAGES: Record<string, string> = {
  conflict: "この経費はほかの人が更新しました。画面を開き直してください。",
  status: "この操作はできません。画面を開き直してください。",
  failed: "保存できませんでした。時間をおいてもう一度お試しください。",
};

const amountText = (n: number, show: boolean) => (show ? String(n) : "");

// 画面の欄の初めの値
const initialValuesOf = (e: Expense): Record<string, string> => {
  const show = e.total > 0 || e.total10 > 0 || e.total8 > 0 || e.totalExempt > 0;
  return {
    spent_on: e.spentOn ?? "",
    payee_name: e.payeeName ?? "",
    total: amountText(e.total, show),
    total_10: amountText(e.total10, show),
    tax_10: amountText(e.tax10, show),
    total_8: amountText(e.total8, show),
    tax_8: amountText(e.tax8, show),
    total_exempt: amountText(e.totalExempt, show),
    registration_no: e.registrationNo ?? "",
    items_text: e.itemsText ?? "",
    purpose: e.purpose ?? "",
    payment_method: e.paymentMethod,
    account_title_id: e.accountTitleId ?? "",
    attendees: e.attendees ?? "",
    no_receipt_reason: e.noReceiptReason ?? "",
  };
};

export default async function ExpensePage({ params, searchParams }: PageProps<"/expenses/[id]">) {
  const { id } = await params;
  const me = await requireAccess("expenses_apply", expenseUrl(id));
  const query = await searchParams;

  // 手順1: CH-02 本人の経費
  const expense = await getOwnExpense(id, me.id);
  if (!expense) redirect(`${EXPENSES_URL}?error=not_found`);
  const editable = expense.status === "draft" || expense.status === "returned";
  const titles = await listAccountTitles();

  // 手順2: 領収書の期限付きURL(10分)
  const urls = expense.receiptFileId ? await getSignedUrls([expense.receiptFileId]) : new Map<string, string>();
  const receiptUrl = expense.receiptFileId ? (urls.get(expense.receiptFileId) ?? null) : null;

  // ⚠ 要確認(AIの読み取り結果。CH-19)と、二重計上の疑い(申請の前に知らせる。EV-02 手順7)
  const aiFlags =
    editable && expense.aiRaw
      ? (normalizeAiReceipt(
          expense.aiRaw,
          titles.filter((t) => t.isActive).map((t) => t.name)
        )?.flags ?? [])
      : [];
  const duplicate = editable
    ? await findDuplicate({
        id: expense.id,
        receiptFileId: expense.receiptFileId,
        payeeKey: expense.payeeKey,
        spentOn: expense.spentOn,
        total: expense.total,
      })
    : null;

  const aiParam = str(query.ai);
  const done = DONE_MESSAGES[str(query.done)];
  const error = ERROR_MESSAGES[str(query.error)];
  const titleOptions = titles
    .filter((t) => t.isActive || t.id === expense.accountTitleId)
    .map((t) => ({ id: t.id, name: t.name }));
  const estimated =
    expense.accountTitleId && (expense.accountTitleSource === "history" || expense.accountTitleSource === "ai") && expense.accountTitleReason
      ? { titleId: expense.accountTitleId, reason: expense.accountTitleReason, ai: expense.accountTitleSource === "ai" }
      : null;
  // 一度も申請していない、AIが読み取った下書きは AiDraft で囲む
  const aiRead =
    editable && expense.aiReadAt && !expense.submittedAt ? { createdAt: expense.aiReadAt.toISOString() } : null;

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href={EXPENSES_URL} label="一覧へ" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">経費の申請</h1>
          <Badge tone={EXPENSE_STATUS_TONES[expense.status]}>{EXPENSE_STATUSES[expense.status]}</Badge>
        </div>
        {done && <Alert tone="success">{done}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {/* ② AIが使えなかったとき(手入力) */}
        {aiParam && editable && <Alert tone="warning">AIの案を作れませんでした。手で入力してください。</Alert>}
        {/* ③ 差し戻されたとき */}
        {expense.status === "returned" && (
          <Alert tone="error">
            差し戻されました（{expense.returnedAt ? formatDateShort(expense.returnedAt) : ""} {expense.returnedByName ?? ""}）
            <br />
            理由: {expense.returnReason}
          </Alert>
        )}

        {expense.receiptFileId && (
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <h2 className="font-bold">領収書</h2>
            {receiptUrl ? (
              <a href={receiptUrl} target="_blank" rel="noreferrer" className="block" aria-label="領収書の写真を大きく表示する">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptUrl} alt="領収書の写真" className="max-h-64 w-full rounded-md object-contain" />
              </a>
            ) : (
              <p className="text-sm text-ink-muted">表示できません</p>
            )}
            {editable && (
              <details>
                <summary className="min-h-11 cursor-pointer content-center text-sm font-bold text-primary">撮り直す</summary>
                <ReceiptCapture
                  action={retakeReceipt.bind(null, expense.id)}
                  endpoint={`${EXPENSES_URL}/files`}
                  configured={isStorageConfigured()}
                  version={expense.version}
                />
              </details>
            )}
          </section>
        )}

        {duplicate && editable && <Alert tone="warning">{duplicateMessage(duplicate)}</Alert>}

        {editable ? (
          <ExpenseForm
            action={saveExpense.bind(null, expense.id)}
            initialValues={initialValuesOf(expense)}
            version={expense.version}
            titles={titleOptions}
            estimated={estimated}
            aiRead={aiRead}
            aiFlags={aiFlags}
            hasReceipt={expense.receiptFileId !== null}
            returned={expense.status === "returned"}
          />
        ) : (
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <ExpenseDetail expense={expense} />
            {expense.submittedAt && <p className="text-sm text-ink-muted">申請 {formatDateTime(expense.submittedAt)}</p>}
            {expense.status === "approved" && expense.approvedAt && (
              <p className="text-sm text-success">
                ✓ 承認済み（{expense.approvedByName ?? ""}・{formatDateTime(expense.approvedAt)}）
              </p>
            )}
          </section>
        )}

        {/* ④ 承認待ちのときだけ「取り下げて直す」 */}
        {expense.status === "submitted" && (
          <form action={withdrawExpense.bind(null, expense.id)}>
            <input type="hidden" name="version" value={expense.version} />
            <input type="hidden" name="intent" value="to_draft" />
            <ConfirmSubmitButton
              variant="secondary"
              className="w-full"
              pendingText="取り下げ中…"
              confirmMessage="この申請を取り下げて、下書きに戻してよいですか？"
            >
              取り下げて直す
            </ConfirmSubmitButton>
          </form>
        )}
        {/* ③ 差し戻しのとき「この申請を取り下げる」 */}
        {expense.status === "returned" && (
          <form action={withdrawExpense.bind(null, expense.id)}>
            <input type="hidden" name="version" value={expense.version} />
            <input type="hidden" name="intent" value="withdraw" />
            <ConfirmSubmitButton variant="danger" pendingText="取り下げ中…" confirmMessage="この申請を取り下げてよいですか？">
              この申請を取り下げる
            </ConfirmSubmitButton>
          </form>
        )}
        {/* 一度も申請していない下書きだけ削除できる(EV-10) */}
        {expense.status === "draft" && !expense.submittedAt && (
          <form action={deleteExpenseDraft.bind(null, expense.id)}>
            <input type="hidden" name="version" value={expense.version} />
            <ConfirmSubmitButton
              variant="danger"
              pendingText="削除中…"
              confirmMessage="この下書きを削除してよいですか？削除すると元に戻せません。"
            >
              この下書きを削除する
            </ConfirmSubmitButton>
          </form>
        )}
      </main>
    </>
  );
}
