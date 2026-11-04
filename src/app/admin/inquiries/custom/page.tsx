import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { CUSTOM_QUOTE_STATUSES, isCustomQuoteStatus } from "@/utils/customQuote";
import { formatDate, formatDateShort, formatQuantity } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Pagination } from "@/components/Pagination";
import { TextInput } from "@/components/TextInput";
import { QUOTE_PAGE_SIZE, listQuotes, type QuoteFilter } from "./quoteData";
import { QUOTE_STATUS_TONES } from "./quoteView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

// 【仮】希望納期は MM/DD（曜）。今年と年が違うときは YYYY/MM/DD（曜）(02 の G02。00_仮決め一覧 D-04-仮-15)
const desiredDateText = (date: string, thisYear: string): string =>
  date.startsWith(thisYear) ? formatDateShort(date) : formatDate(date);

// D-04 G02 特注の案件の一覧(03 EV-04)。初めは進行中(受注・失注・取消以外)を、新しい順に50件ずつ
export default async function CustomQuotesPage({ searchParams }: PageProps<"/admin/inquiries/custom">) {
  await requireAccess("inquiries", "/admin/inquiries/custom");
  const params = await searchParams;
  const statusParam = str(params.status);
  const filter: QuoteFilter = {
    status: statusParam === "all" || isCustomQuoteStatus(statusParam) ? statusParam : "open",
    q: str(params.q).slice(0, 100),
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));
  const { total, items } = await listQuotes(filter, page);
  const thisYear = todayJST().slice(0, 4);

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (filter.status !== "open") sp.set("status", filter.status);
    if (filter.q) sp.set("q", filter.q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/inquiries/custom${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">特注の案件</h1>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="status" label="状態">
          <AutoSubmitSelect id="status" name="status" defaultValue={filter.status} className="w-64">
            <option value="open">進行中（受注・失注・取消以外）</option>
            <option value="all">すべて</option>
            {Object.entries(CUSTOM_QUOTE_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </Field>
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={filter.q} placeholder="団体名・番号" className="w-64" />
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          message={
            filter.q || filter.status !== "open"
              ? "条件に合う案件はありません。"
              : "特注の案件はまだありません。種類が「特注の相談」の問い合わせの画面から作れます。"
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">番号</th>
                  <th className="px-3 py-2">団体名</th>
                  <th className="px-3 py-2">品目</th>
                  <th className="px-3 py-2 text-right">枚数</th>
                  <th className="px-3 py-2">希望納期</th>
                  <th className="px-3 py-2 text-right">概算（税込・円）</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">担当</th>
                </tr>
              </thead>
              <tbody>
                {items.map((q) => (
                  <tr key={q.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/admin/inquiries/custom/${q.id}`} className="font-bold text-primary hover:underline">
                        {q.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{q.organizationName ?? "−"}</td>
                    <td className="px-3 py-2">{q.spec.itemType ?? "−"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{q.spec.quantity !== null ? formatQuantity(q.spec.quantity) : "−"}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {q.spec.desiredDate ? desiredDateText(q.spec.desiredDate, thisYear) : "−"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{q.estimate ? formatQuantity(q.estimate.total) : "−"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge tone={QUOTE_STATUS_TONES[q.status]}>{CUSTOM_QUOTE_STATUSES[q.status]}</Badge>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{q.assigneeName ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={QUOTE_PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
    </div>
  );
}
