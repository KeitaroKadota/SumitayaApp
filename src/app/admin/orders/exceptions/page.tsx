import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { SHOP_LABELS } from "@/utils/crossmall/types";
import { formatDateShort, formatQuantity } from "@/utils/format";
import { getCalendar, type CalendarDay } from "@/utils/holidays";
import { toDateJST } from "@/utils/jst";
import { ORDER_EXCEPTION_RULES, ORDER_EXCEPTION_RULE_CODES, isOrderExceptionRule } from "@/utils/orderExceptionRules";
import {
  EXCEPTION_PAGE_SIZE,
  ORDER_EXCEPTIONS_URL,
  RECHECK_DAYS,
  listExceptionOrders,
  orderUrl,
  type ExceptionStatusFilter,
} from "@/utils/orderExceptions";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { recheckOrderExceptions } from "./actions";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

const STATUS_OPTIONS = [
  { value: "open", label: "未対応" },
  { value: "resolved", label: "対応済み" },
  { value: "all", label: "すべて" },
] as const;
const isStatusFilter = (v: string): v is ExceptionStatusFilter => v === "open" || v === "resolved" || v === "all";

// 日付の表示「11/20（金）休」(店舗の定休日・休業日は「休」、祝日で営業する日は「祝」。00_画面共通ルール 6.2)
function DayText({ date, calendar }: { date: string; calendar: Map<string, CalendarDay> }) {
  const day = calendar.get(date);
  const mark = day?.isClosed ? "休" : day?.kind === "national" ? "祝" : "";
  return (
    <>
      {formatDateShort(date)}
      {mark && <span className="ml-1 text-ink-muted">{mark}</span>}
    </>
  );
}

// G01 例外注文の一覧(B-02 03 EV-03)。条件は URL の ?status=&rule=&page= で持つ(既定は未対応)。
// スクロール360へ出荷を依頼するボタン・出力は置かない(2026-11-08 決定。依頼はいままでどおりの方法で行う)
// (props の型は PageProps<"/admin/orders/exceptions"> と同じ形。型の生成〔next typegen〕の前でも通るように書いた)
export default async function OrderExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 手順1
  await requireAccess("orders", ORDER_EXCEPTIONS_URL);
  const params = await searchParams;

  // 手順2: 条件(状態・理由)
  const statusParam = str(params.status);
  const status: ExceptionStatusFilter = isStatusFilter(statusParam) ? statusParam : "open";
  const ruleParam = str(params.rule);
  const rule = isOrderExceptionRule(ruleParam) ? ruleParam : "";
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  // 手順2・3: 注文ごとにまとめて、お届け希望日の近い順 → 注文日時の古い順
  const { total, items } = await listExceptionOrders(status, rule, page);
  const days = items
    .flatMap((o) => [toDateJST(o.orderedAt), o.requestedDeliveryDate])
    .filter((d): d is string => Boolean(d))
    .sort();
  const calendar = days.length > 0 ? await getCalendar(days[0], days[days.length - 1]) : new Map<string, CalendarDay>();

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (status !== "open") sp.set("status", status);
    if (rule) sp.set("rule", rule);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `${ORDER_EXCEPTIONS_URL}${qs ? `?${qs}` : ""}`;
  };

  // EV-02 手順4: 調べ直した結果(?rechecked=調べた数,新しい例外の数 / failed)
  const rechecked = str(params.rechecked);
  const [checked, found] = rechecked.split(",").map((n) => Number(n));
  const recheckedMessage =
    rechecked && rechecked !== "failed" && Number.isFinite(checked) && Number.isFinite(found)
      ? `${formatQuantity(checked)}件の注文を調べ、新しい例外が${formatQuantity(found)}件ありました。`
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/orders" label="受注の一覧へ" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">例外注文</h1>
        <form action={recheckOrderExceptions}>
          <SubmitButton variant="secondary" pendingText="調べています…">
            例外を調べ直す
          </SubmitButton>
        </form>
      </div>
      <p className="text-sm text-ink-muted">
        「例外を調べ直す」は、直近{RECHECK_DAYS}日に注文された、まだ出荷していない注文をもう一度調べます（受注CSVの取り込みのあとの確認に失敗したときに使います）。
      </p>

      {recheckedMessage && <Alert tone="success">{recheckedMessage}</Alert>}
      {rechecked === "failed" && <Alert tone="error">例外を調べ直せませんでした。時間をおいてもう一度お試しください。</Alert>}

      <form method="get" className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
        <RadioGroup name="status" label="状態" options={STATUS_OPTIONS} defaultValue={status} />
        <Field id="rule" label="理由">
          <Select id="rule" name="rule" defaultValue={rule} className="w-64">
            <option value="">すべて</option>
            {ORDER_EXCEPTION_RULE_CODES.map((code) => (
              <option key={code} value={code}>
                {ORDER_EXCEPTION_RULES[code]}
              </option>
            ))}
          </Select>
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          絞り込む
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState message={status === "open" ? "未対応の例外注文はありません。" : "条件に合う例外注文はありません。"} />
      ) : (
        <>
          <Pagination total={total} page={page} pageSize={EXCEPTION_PAGE_SIZE} hrefOf={hrefOf} />
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">注文日</th>
                  <th className="px-3 py-2">販路・番号</th>
                  <th className="px-3 py-2">注文者</th>
                  <th className="px-3 py-2">理由</th>
                  <th className="px-3 py-2">希望日</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-b border-line align-top last:border-b-0 hover:bg-canvas">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      <DayText date={toDateJST(o.orderedAt)} calendar={calendar} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {SHOP_LABELS[o.shop]}{" "}
                      <Link href={orderUrl(o.id)} className="font-bold text-primary hover:underline">
                        {o.shopOrderNo ?? o.crossmallOrderNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{o.customerName}</td>
                    <td className="px-3 py-2">
                      <ul className="flex flex-col gap-1">
                        {o.exceptions.map((e) => (
                          <li key={e.id}>
                            <span className="font-bold">{ORDER_EXCEPTION_RULES[e.rule]}</span>（{e.reason}）
                            {e.status === "resolved" && (
                              <span className="ml-1">
                                <Badge tone="success">対応済み</Badge>
                              </span>
                            )}
                            {!e.stillMatches && (
                              <p className="text-xs text-ink-muted">※取り込み直しで直った可能性があります</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {o.requestedDeliveryDate ? <DayText date={o.requestedDeliveryDate} calendar={calendar} /> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={EXCEPTION_PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
      <p className="text-sm text-ink-muted tabular-nums">
        {STATUS_OPTIONS.find((s) => s.value === status)?.label} {formatQuantity(total)}件
      </p>
    </div>
  );
}
