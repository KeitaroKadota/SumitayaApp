import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatQuantity } from "@/utils/format";
import { listActiveSuppliers } from "@/utils/masters";
import { MATCH_RESULTS, PAYABLES_PAGE_SIZE, PAYABLE_STATUSES, topReasonText } from "@/utils/payables";
import { countPayablesByTab, isPayableId, listPayables, type PayableFilter, type PayableTab } from "@/utils/payablesServer";
import { isValidDateStr, parseNonNegativeInt } from "@/utils/textNormalize";
import { AiBadge } from "@/components/AiDraft";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import { LIST_URL, MATCH_TONES, SCHEDULE_URL, STATUS_TONES } from "./payablesView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

const TABS: { key: PayableTab; label: string }[] = [
  { key: "needs_review", label: "確認待ち" },
  { key: "scheduled", label: "支払予定" },
  { key: "cancelled", label: "取消" },
  { key: "all", label: "すべて" },
];

const DONE_MESSAGES: Record<string, string> = {
  registered: "登録しました。",
  scheduled: "支払予定にしました。",
  cancelled: "取り消しました。",
};
const ERROR_MESSAGES: Record<string, string> = { not_found: "この請求書は見つかりません。" };

// G01 受け取った請求書の一覧(E-04 03 EV-01)。初めは確認待ちを、支払予定日の早い順に50件ずつ
export default async function PayablesPage({ searchParams }: PageProps<"/admin/payables">) {
  await requireAccess("payables", LIST_URL);
  const params = await searchParams;

  // 手順1: 絞り込み(日付・金額の形がおかしければ無視する)
  const tabParam = str(params.status);
  const date = (v: string) => (isValidDateStr(v) ? v : "");
  const amount = (v: string) => {
    const n = parseNonNegativeInt(v, 99_999_999);
    return typeof n === "number" ? n : null;
  };
  const supplierParam = str(params.supplier);
  const filter: PayableFilter = {
    tab: TABS.some((t) => t.key === tabParam) ? (tabParam as PayableTab) : "needs_review",
    supplierId: isPayableId(supplierParam) ? supplierParam : "",
    dateFrom: date(str(params.from)),
    dateTo: date(str(params.to)),
    amountMin: amount(str(params.min)),
    amountMax: amount(str(params.max)),
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  // 手順2・3
  const { total, items } = await listPayables(filter, page);
  const counts = await countPayablesByTab();
  const suppliers = await listActiveSuppliers();
  const done = DONE_MESSAGES[str(params.done)];
  const error = ERROR_MESSAGES[str(params.error)];

  const hrefOf = (p: number, tab: PayableTab = filter.tab) => {
    const sp = new URLSearchParams();
    if (tab !== "needs_review") sp.set("status", tab);
    if (filter.supplierId) sp.set("supplier", filter.supplierId);
    if (filter.dateFrom) sp.set("from", filter.dateFrom);
    if (filter.dateTo) sp.set("to", filter.dateTo);
    if (filter.amountMin !== null) sp.set("min", String(filter.amountMin));
    if (filter.amountMax !== null) sp.set("max", String(filter.amountMax));
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `${LIST_URL}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">受け取った請求書</h1>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={SCHEDULE_URL}>支払予定を見る</LinkButton>
          <LinkButton href="/admin/payables/new" variant="primary">
            請求書を登録する
          </LinkButton>
        </div>
      </div>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <nav aria-label="状態" className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = t.key === filter.tab;
          return (
            <Link
              key={t.key}
              href={hrefOf(1, t.key)}
              aria-current={active ? "page" : undefined}
              className={buttonClassName(active ? "primary" : "secondary")}
            >
              {t.label}
              {t.key !== "all" && counts[t.key] > 0 && <Badge tone={t.key === "needs_review" ? "warning" : "neutral"}>{formatQuantity(counts[t.key])}</Badge>}
            </Link>
          );
        })}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        {filter.tab !== "needs_review" && <input type="hidden" name="status" value={filter.tab} />}
        <Field id="supplier" label="仕入先">
          <Select id="supplier" name="supplier" defaultValue={filter.supplierId} className="w-52">
            <option value="">すべて</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="from" label="請求の日付（から）">
          <TextInput id="from" name="from" type="date" defaultValue={filter.dateFrom} className="w-44" />
        </Field>
        <Field id="to" label="請求の日付（まで）">
          <TextInput id="to" name="to" type="date" defaultValue={filter.dateTo} className="w-44" />
        </Field>
        <Field id="min" label="ご請求額（円・から）">
          <TextInput id="min" name="min" inputMode="numeric" defaultValue={filter.amountMin ?? ""} className="w-36" />
        </Field>
        <Field id="max" label="ご請求額（円・まで）">
          <TextInput id="max" name="max" inputMode="numeric" defaultValue={filter.amountMax ?? ""} className="w-36" />
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          message={filter.tab === "needs_review" ? "確認待ちの請求書はまだありません。" : "条件に合う請求書はありません。"}
          action={
            <LinkButton href="/admin/payables/new" variant="primary">
              請求書を登録する
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">請求元</th>
                  <th className="px-3 py-2">請求日</th>
                  <th className="px-3 py-2">締め日</th>
                  <th className="px-3 py-2 text-right">ご請求額（税込・円）</th>
                  <th className="px-3 py-2">支払予定日</th>
                  <th className="px-3 py-2">突合</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const reason = i.status === "needs_review" || i.status === "reading" ? topReasonText(i.reviewReasons, i.matchResult) : null;
                  const notReviewed = i.reviewedAt === null && i.aiRaw !== null && i.status !== "cancelled";
                  return (
                    <tr key={i.id} className="border-b border-line align-top last:border-b-0 hover:bg-canvas">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={i.status === "cancelled" ? "line-through" : ""}>
                          <Badge tone={STATUS_TONES[i.status]}>{PAYABLE_STATUSES[i.status]}</Badge>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/admin/payables/${i.id}`} className="font-bold text-primary hover:underline">
                            {i.payeeName ?? i.supplierName ?? "（請求元の名前なし）"}
                          </Link>
                          {notReviewed && <AiBadge />}
                        </div>
                        {reason && <p className="mt-1 text-warning">⚠ {reason}</p>}
                        {!i.registrationNo && i.status !== "reading" && (
                          <p className="mt-1 text-xs text-ink-muted">⚠ 登録番号なし（インボイスでない可能性）</p>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{i.invoiceDate ? formatDateShort(i.invoiceDate) : "−"}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{i.periodEnd ? formatDateShort(i.periodEnd) : "−"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(i.amountDue)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{i.dueOn ? formatDateShort(i.dueOn) : "未定"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge tone={MATCH_TONES[i.matchResult]}>{MATCH_RESULTS[i.matchResult]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={PAYABLES_PAGE_SIZE} hrefOf={(p) => hrefOf(p)} />
        </>
      )}
    </div>
  );
}
