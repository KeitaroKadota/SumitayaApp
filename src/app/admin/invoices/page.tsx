import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatQuantity, formatYearMonth } from "@/utils/format";
import { INVOICES_PAGE_SIZE } from "@/utils/invoices";
import {
  INVOICES_URL,
  countDraftInvoices,
  invoiceUrl,
  isInvoiceId,
  listInvoiceCustomers,
  listInvoices,
  type InvoiceFilter,
  type InvoiceTab,
  type PaymentFilter,
} from "@/utils/invoicesServer";
import { todayJST } from "@/utils/jst";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { PeriodNav } from "@/components/PeriodNav";
import { Select } from "@/components/Select";
import { PaymentBadge, StatusBadge, addresseeOfInvoice } from "./invoicesView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

const TABS: { key: InvoiceTab; label: string }[] = [
  { key: "draft", label: "下書き" },
  { key: "issued", label: "発行済み" },
  { key: "void", label: "取消" },
  { key: "all", label: "すべて" },
];
const PAYMENTS: { key: PaymentFilter; label: string }[] = [
  { key: "", label: "すべて" },
  { key: "unpaid", label: "未入金" },
  { key: "paid", label: "入金済み" },
  { key: "overdue", label: "期限切れ" },
];

const DONE_MESSAGES: Record<string, string> = {
  issued: "発行しました。",
  voided: "取り消しました。",
  deleted: "削除しました。",
  saved: "保存しました。",
};
const ERROR_MESSAGES: Record<string, string> = { not_found: "この請求書は見つかりません。" };

const shiftMonth = (month: string, diff: number): string => {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + diff;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};

// G01 請求書の一覧(E-05 03 EV-01)。下書きを先に、そのほかは発行日の新しい順に50件ずつ
export default async function InvoicesPage({ searchParams }: PageProps<"/admin/invoices">) {
  await requireAccess("receivables", INVOICES_URL);
  const params = await searchParams;
  const today = todayJST();

  // 手順1: 絞り込み(形がおかしければ無視する)。【仮】初めは「すべて」の状態で、今月の発行日(00_仮決め一覧 E-05-仮-09)
  const tabParam = str(params.status);
  const paymentParam = str(params.payment);
  const customerParam = str(params.customer);
  const monthParam = str(params.month);
  const filter: InvoiceFilter = {
    tab: TABS.some((t) => t.key === tabParam) ? (tabParam as InvoiceTab) : "all",
    payment: PAYMENTS.some((p) => p.key === paymentParam) ? (paymentParam as PaymentFilter) : "",
    customerId: isInvoiceId(customerParam) ? customerParam : "",
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : today.slice(0, 7),
    today,
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  // 手順2・3
  const { total, items } = await listInvoices(filter, page);
  const drafts = await countDraftInvoices();
  const customers = await listInvoiceCustomers();
  const done = DONE_MESSAGES[str(params.done)];
  const error = ERROR_MESSAGES[str(params.error)];

  const hrefOf = (p: number, change: Partial<Pick<InvoiceFilter, "tab" | "month">> = {}) => {
    const sp = new URLSearchParams();
    const tab = change.tab ?? filter.tab;
    const month = change.month ?? filter.month;
    if (tab !== "all") sp.set("status", tab);
    if (filter.payment) sp.set("payment", filter.payment);
    if (filter.customerId) sp.set("customer", filter.customerId);
    if (month !== today.slice(0, 7)) sp.set("month", month);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `${INVOICES_URL}${qs ? `?${qs}` : ""}`;
  };
  const monthLabel = (m: string) => formatYearMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
  const prevMonth = shiftMonth(filter.month, -1);
  const nextMonth = shiftMonth(filter.month, 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">請求書の発行</h1>
        <LinkButton href={`${INVOICES_URL}/new`} variant="primary">
          請求書を作る
        </LinkButton>
      </div>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <nav aria-label="状態" className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = t.key === filter.tab;
          return (
            <Link
              key={t.key}
              href={hrefOf(1, { tab: t.key })}
              aria-current={active ? "page" : undefined}
              className={buttonClassName(active ? "primary" : "secondary")}
            >
              {t.label}
              {t.key === "draft" && drafts > 0 && <Badge tone="neutral">{formatQuantity(drafts)}</Badge>}
            </Link>
          );
        })}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        {filter.tab !== "all" && <input type="hidden" name="status" value={filter.tab} />}
        {filter.month !== today.slice(0, 7) && <input type="hidden" name="month" value={filter.month} />}
        <Field id="payment" label="入金">
          <Select id="payment" name="payment" defaultValue={filter.payment} className="w-40">
            {PAYMENTS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="customer" label="取引先">
          <Select id="customer" name="customer" defaultValue={filter.customerId} className="w-56">
            <option value="">すべて</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          絞り込む
        </button>
      </form>

      <div className="max-w-sm">
        <PeriodNav
          label={`${monthLabel(filter.month)}（発行日）`}
          prev={{ href: hrefOf(1, { month: prevMonth }), label: monthLabel(prevMonth) }}
          next={{ href: hrefOf(1, { month: nextMonth }), label: monthLabel(nextMonth) }}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          message="条件に合う請求書はありません。"
          action={
            <LinkButton href={`${INVOICES_URL}/new`} variant="primary">
              請求書を作る
            </LinkButton>
          }
        />
      ) : (
        // 選んだものを印刷する: 印刷のページ(G03)を新しいタブで開く(EV-06)
        <form method="get" action={`${INVOICES_URL}/print`} target="_blank" className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">
                    <span className="sr-only">印刷する</span>
                  </th>
                  <th className="px-3 py-2">番号</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">発行日</th>
                  <th className="px-3 py-2">取引先</th>
                  <th className="px-3 py-2 text-right">ご請求額（税込・円）</th>
                  <th className="px-3 py-2">期限</th>
                  <th className="px-3 py-2">入金</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-line align-top last:border-b-0 hover:bg-canvas">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name="ids"
                        value={i.id}
                        aria-label={`${i.invoiceNo ?? "下書き"}を印刷する`}
                        className="size-5 accent-primary"
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      <Link href={invoiceUrl(i.id)} className="font-bold text-primary hover:underline">
                        {i.invoiceNo ?? "（下書き）"}
                      </Link>
                      {i.status === "void" && i.replacedByNo && (
                        <p className="mt-1 text-xs text-ink-muted">訂正で {i.replacedByNo} に差し替え</p>
                      )}
                      {i.status === "draft" && i.replacesInvoiceNo && (
                        <p className="mt-1 text-xs text-ink-muted">{i.replacesInvoiceNo} の訂正</p>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {i.status === "draft" || !i.issuedOn ? "−" : formatDateShort(i.issuedOn)}
                    </td>
                    <td className="px-3 py-2 break-words">{addresseeOfInvoice(i)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(i.total)}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {i.status === "draft" || !i.dueOn ? "−" : formatDateShort(i.dueOn)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <PaymentBadge status={i.status} paymentStatus={i.paymentStatus} dueOn={i.dueOn} today={today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="submit" className={buttonClassName("secondary")}>
              選んだものを印刷する
            </button>
            <Pagination total={total} page={page} pageSize={INVOICES_PAGE_SIZE} hrefOf={(p) => hrefOf(p)} />
          </div>
        </form>
      )}
    </div>
  );
}
