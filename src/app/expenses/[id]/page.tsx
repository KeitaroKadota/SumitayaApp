// G02 経費の登録(確認・修正・登録。スマホ。E-07 03 EV-04)。機能キー expenses_apply(全員)。本人の経費だけ(CH-02)。
// 状態に合わせて出し分ける(02 G02 の①〜③): 下書きは入力欄、登録済みは読むだけ(直すボタンは出さない。01 4.1)。
import { redirect } from "next/navigation";
import { fullName, requireAccess } from "@/utils/auth";
import { EXPENSE_STATUSES, duplicateMessage, normalizeAiReceipt } from "@/utils/expenseClaims";
import {
  EXPENSES_URL,
  expenseFlagsForDisplay,
  expenseUrl,
  getOwnExpense,
  listAccountTitles,
  type Expense,
} from "@/utils/expenseClaimsServer";
import { formatDateTime } from "@/utils/format";
import { getSignedUrls, isStorageConfigured } from "@/utils/storage";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { BackLink } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { deleteExpenseDraft, retakeReceipt, saveExpense } from "../actions";
import { ExpenseDetail } from "../ExpenseDetail";
import { EXPENSE_STATUS_TONES } from "../expensesView";
import { ReceiptCapture } from "../ReceiptCapture";
import { ExpenseForm } from "./ExpenseForm";

// 「撮り直す」は AI の読み取り(30秒で打ち切り)を待つので、操作の時間の上限を長めにする
export const maxDuration = 60;

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

const DONE_MESSAGES: Record<string, string> = {
  reread: "領収書を撮り直して、読み取りました。",
};
const ERROR_MESSAGES: Record<string, string> = {
  conflict: "この経費はほかの画面で更新されました。画面を開き直してください。",
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
  const editable = expense.status === "draft";
  const titles = await listAccountTitles();

  // 手順2: 領収書の期限付きURL(10分)
  const urls = expense.receiptFileId ? await getSignedUrls([expense.receiptFileId]) : new Map<string, string>();
  const receiptUrl = expense.receiptFileId ? (urls.get(expense.receiptFileId) ?? null) : null;

  // ⚠ 要確認(AIの読み取り結果。CH-19)と、二重計上の疑い(登録の前に知らせる。EV-02 手順7)
  const aiFlags =
    editable && expense.aiRaw
      ? (normalizeAiReceipt(
          expense.aiRaw,
          titles.filter((t) => t.isActive).map((t) => t.name)
        )?.flags ?? [])
      : [];
  // 手順3: 確認が必要な点(印)。下書きは今の内容で 0.3 を計算して出す(保存はしない)。登録済みは保存した印の文を出す。
  // 下書きの二重計上の疑いは、上に別の Alert で出す
  const checked = await expenseFlagsForDisplay(expense);
  const duplicate = editable ? checked.duplicate : null;
  const flags = editable ? checked.flags.filter((f) => f.code !== "CH-09") : checked.flags;

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
  // AIが読み取った下書きは AiDraft で囲む
  const aiRead = editable && expense.aiReadAt ? { createdAt: expense.aiReadAt.toISOString() } : null;

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href={EXPENSES_URL} label="一覧へ" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">経費の登録</h1>
          <Badge tone={EXPENSE_STATUS_TONES[expense.status]}>{EXPENSE_STATUSES[expense.status]}</Badge>
        </div>
        {done && <Alert tone="success">{done}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {/* ② AIが使えなかったとき(手入力) */}
        {aiParam && editable && <Alert tone="warning">AIの案を作れませんでした。手で入力してください。</Alert>}

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
        {/* 印(決まりに合わない点)。登録は止めない(登録後は一覧で「要確認」) */}
        {flags.length > 0 && (
          <Alert tone="warning">
            <span className="font-bold">確認が必要な点</span>
            <ul className="flex flex-col gap-1">
              {flags.map((f, i) => (
                <li key={`${f.code}-${i}`}>・{f.message}</li>
              ))}
            </ul>
          </Alert>
        )}

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
          />
        ) : (
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <ExpenseDetail expense={expense} />
            {expense.confirmedAt && <p className="text-sm text-ink-muted">登録 {formatDateTime(expense.confirmedAt)}</p>}
          </section>
        )}

        {/* 下書きだけ削除できる(EV-10) */}
        {expense.status === "draft" && (
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
