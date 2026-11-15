import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatQuantity } from "@/utils/format";
import { getCalendar, type CalendarDay } from "@/utils/holidays";
import { listActiveSuppliers } from "@/utils/masters";
import {
  RECEIVING_URL,
  countReceiving,
  isReceivingView,
  listReceiving,
  receivingUrl,
  type ReceivingFilter,
} from "@/utils/receiving";
import { MATCH_STATUSES, RECEIVING_RULES } from "@/utils/receivingMatch";
import { isValidDateStr } from "@/utils/textNormalize";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VIEWS = { review: "要確認", accepted: "検収済み", all: "すべて" } as const;

// G01 検収の一覧(C-02 02 G01・03 EV-09)。機能キー purchasing。条件は URL の ?view=&supplier=&from=&to=&page= で持つ
export default async function ReceivingListPage({
  searchParams,
}: {
  // (props の型は PageProps<"/admin/purchasing/receiving"> と同じ形。型の生成〔next typegen〕の前でも通るように書いた)
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 手順1
  await requireAccess("purchasing", RECEIVING_URL);
  const params = await searchParams;

  const viewParam = str(params.view);
  const supplierParam = str(params.supplier);
  const fromParam = str(params.from);
  const toParam = str(params.to);
  // 手順2: 既定は「要確認」
  const filter: ReceivingFilter = {
    view: isReceivingView(viewParam) ? viewParam : "review",
    supplierId: UUID_PATTERN.test(supplierParam) ? supplierParam : "",
    from: isValidDateStr(fromParam) ? fromParam : "",
    to: isValidDateStr(toParam) ? toParam : "",
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  const { total, items } = await listReceiving(filter, page);
  // 手順3
  const counts = await countReceiving();
  const monthTotal = Object.values(counts.month).reduce((a, b) => a + b, 0);
  const suppliers = await listActiveSuppliers();
  const days = items.map((s) => s.deliveryDate).filter((d): d is string => Boolean(d)).sort();
  const calendar = days.length > 0 ? await getCalendar(days[0], days[days.length - 1]) : new Map<string, CalendarDay>();

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (filter.view !== "review") sp.set("view", filter.view);
    if (filter.supplierId) sp.set("supplier", filter.supplierId);
    if (filter.from) sp.set("from", filter.from);
    if (filter.to) sp.set("to", filter.to);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `${RECEIVING_URL}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">検収</h1>
      {str(params.done) === "accepted" && (
        <Alert tone="success">検収しました。CROSS MALL の在庫に入荷を入力してください。</Alert>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="view" label="表示">
          <Select id="view" name="view" defaultValue={filter.view} className="w-36">
            {Object.entries(VIEWS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="supplier" label="仕入先">
          <Select id="supplier" name="supplier" defaultValue={filter.supplierId} className="w-56">
            <option value="">すべて</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="from" label="納品日（開始）">
          <TextInput id="from" name="from" type="date" defaultValue={filter.from} className="w-44" />
        </Field>
        <Field id="to" label="納品日（終了）">
          <TextInput id="to" name="to" type="date" defaultValue={filter.to} className="w-44" />
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          検索
        </button>
      </form>

      <p className="text-sm">
        要確認 <span className="font-bold">{counts.review}件</span>／今月の検収 <span className="font-bold">{monthTotal}件</span>（自動{" "}
        {counts.month.auto_accepted}・確認して検収 {counts.month.reviewed}・発注なし {counts.month.no_order}）
      </p>

      {items.length === 0 ? (
        <EmptyState message="条件に合う納品書はありません。" />
      ) : (
        <>
          <Pagination total={total} page={page} pageSize={RECEIVING_RULES.pageSize} hrefOf={hrefOf} />
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">納品日</th>
                  <th className="px-3 py-2">仕入先</th>
                  <th className="px-3 py-2">伝票番号</th>
                  <th className="px-3 py-2 text-right">合計（円）</th>
                  <th className="px-3 py-2">理由</th>
                  <th className="px-3 py-2">状態</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const day = s.deliveryDate ? calendar.get(s.deliveryDate) : undefined;
                  // 休業日は「休」、祝日で営業する日は「祝」(00_画面共通ルール 6.2)
                  const mark = day?.isClosed ? "休" : day?.kind === "national" ? "祝" : "";
                  const accepted = s.status === "accepted";
                  return (
                    <tr key={s.id} className="border-b border-line align-top last:border-b-0 hover:bg-canvas">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        <Link href={receivingUrl(s.id)} className="font-bold text-primary hover:underline">
                          {s.deliveryDate ? formatDateShort(s.deliveryDate) : "（未入力）"}
                        </Link>
                        {mark && <span className="ml-1 text-ink-muted">{mark}</span>}
                      </td>
                      <td className="px-3 py-2">{s.supplierName ?? "（不明）"}</td>
                      <td className="px-3 py-2 tabular-nums">{s.slipNo ?? ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.total === null ? "" : formatQuantity(s.total)}</td>
                      <td className="px-3 py-2">
                        {!accepted &&
                          s.reviewReasons.map((r) => (
                            <span key={r} className="block">
                              {r}
                            </span>
                          ))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {accepted ? (
                          <Badge tone="success">{s.matchStatus ? MATCH_STATUSES[s.matchStatus] : "検収済み"}</Badge>
                        ) : s.status === "confirmed" ? (
                          <Badge tone="warning">照合待ち</Badge>
                        ) : (
                          <Badge tone="warning">要確認</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={RECEIVING_RULES.pageSize} hrefOf={hrefOf} />
        </>
      )}
    </div>
  );
}
