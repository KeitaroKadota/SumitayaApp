import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { READ_STATUSES, SLIP_PAGE_SIZE, SLIP_STATUSES, isSlipStatus } from "@/utils/deliverySlipRules";
import { CAPTURE_URL, SLIPS_URL, listSlips, slipUrl, type SlipFilter } from "@/utils/deliverySlipServer";
import { formatDateShort, formatQuantity } from "@/utils/format";
import { getAiUsage } from "@/utils/gemini";
import { getCalendar, type CalendarDay } from "@/utils/holidays";
import { listActiveSuppliers } from "@/utils/masters";
import { isValidDateStr } from "@/utils/textNormalize";
import { AiUsageNotice } from "@/components/AiUsageNotice";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// G01 納品書の一覧(C-01 02 G01)。機能キー purchasing。条件は URL の ?status=&supplier=&from=&to=&page= で持つ
export default async function DeliverySlipsPage({
  searchParams,
}: {
  // (props の型は PageProps<"/admin/purchasing/slips"> と同じ形。型の生成〔next typegen〕の前でも通るように書いた)
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess("purchasing", SLIPS_URL);
  const params = await searchParams;

  const statusParam = str(params.status);
  const supplierParam = str(params.supplier);
  const fromParam = str(params.from);
  const toParam = str(params.to);
  const filter: SlipFilter = {
    status: isSlipStatus(statusParam) ? statusParam : "",
    supplierId: UUID_PATTERN.test(supplierParam) ? supplierParam : "",
    from: isValidDateStr(fromParam) ? fromParam : "",
    to: isValidDateStr(toParam) ? toParam : "",
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  const { total, items } = await listSlips(filter, page);
  const suppliers = await listActiveSuppliers();
  const usage = await getAiUsage();
  const days = items.map((s) => s.deliveryDate).filter((d): d is string => Boolean(d)).sort();
  const calendar = days.length > 0 ? await getCalendar(days[0], days[days.length - 1]) : new Map<string, CalendarDay>();

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (filter.status) sp.set("status", filter.status);
    if (filter.supplierId) sp.set("supplier", filter.supplierId);
    if (filter.from) sp.set("from", filter.from);
    if (filter.to) sp.set("to", filter.to);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `${SLIPS_URL}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">納品書</h1>
        <LinkButton href={CAPTURE_URL} variant="primary">
          納品書を上げる
        </LinkButton>
      </div>
      {str(params.error) === "not_found" && <Alert tone="error">この納品書は見つかりません。</Alert>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="status" label="状態">
          <Select id="status" name="status" defaultValue={filter.status} className="w-44">
            <option value="">すべて</option>
            {Object.entries(SLIP_STATUSES).map(([key, label]) => (
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

      {items.length === 0 ? (
        <EmptyState
          message="条件に合う納品書はありません。"
          action={
            <LinkButton href={CAPTURE_URL} variant="primary">
              納品書を上げる
            </LinkButton>
          }
        />
      ) : (
        <>
          <Pagination total={total} page={page} pageSize={SLIP_PAGE_SIZE} hrefOf={hrefOf} />
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">納品日</th>
                  <th className="px-3 py-2">仕入先</th>
                  <th className="px-3 py-2">伝票番号</th>
                  <th className="px-3 py-2 text-right">合計（円）</th>
                  <th className="px-3 py-2">読み取り</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">要</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const day = s.deliveryDate ? calendar.get(s.deliveryDate) : undefined;
                  // 休業日は「休」、祝日で営業する日は「祝」(00_画面共通ルール 6.2)
                  const mark = day?.isClosed ? "休" : day?.kind === "national" ? "祝" : "";
                  return (
                    <tr key={s.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        <Link href={slipUrl(s.id)} className="font-bold text-primary hover:underline">
                          {s.deliveryDate ? formatDateShort(s.deliveryDate) : "（未入力）"}
                        </Link>
                        {mark && <span className="ml-1 text-ink-muted">{mark}</span>}
                      </td>
                      <td className="px-3 py-2">{s.supplierName ?? "（不明）"}</td>
                      <td className="px-3 py-2 tabular-nums">{s.slipNo ?? ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.total === null ? "" : formatQuantity(s.total)}</td>
                      <td className="px-3 py-2">{READ_STATUSES[s.readStatus]}</td>
                      <td className="px-3 py-2">
                        <span className={s.status === "cancelled" ? "line-through" : ""}>{SLIP_STATUSES[s.status]}</span>
                      </td>
                      <td className="px-3 py-2">
                        {s.needsCheck && s.status !== "cancelled" ? (
                          <Badge tone="warning">⚠</Badge>
                        ) : (
                          ""
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={SLIP_PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
      {/* 今日のAIの残り回数(D-01 の共通の関数から。01 7.4) */}
      <AiUsageNotice usage={usage} />
    </div>
  );
}
