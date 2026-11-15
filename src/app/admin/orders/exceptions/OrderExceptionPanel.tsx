// B-02 G02 例外の対応欄(受注の詳細 /admin/orders/[id] の一部。02 G02)。
// 呼ぶ側(B-01 の受注の詳細)で requireAccess("orders") を済ませている前提。理由が1つも無い注文では何も出さない。
import { formatDateTime } from "@/utils/format";
import { ORDER_EXCEPTION_RULES } from "@/utils/orderExceptionRules";
import { listOrderExceptions } from "@/utils/orderExceptions";
import { Badge } from "@/components/Badge";
import { resolveOrderExceptionsAction } from "./actions";
import { ResolveExceptionsForm } from "./ResolveExceptionsForm";

export async function OrderExceptionPanel({ orderId }: { orderId: string }) {
  const exceptions = await listOrderExceptions(orderId);
  if (exceptions.length === 0) return null;
  const open = exceptions.filter((e) => e.status === "open");
  const resolved = exceptions.filter((e) => e.status === "resolved");

  // 履歴: 自動で検出した日時と、対応済みにした日時・人・メモ(同じ時刻はまとめる)
  const history = [
    ...[...new Set(exceptions.map((e) => e.createdAt.toISOString()))].map((at) => ({ at, text: "自動で検出" })),
    ...[
      ...new Map(
        resolved
          .filter((e) => e.resolvedAt)
          .map((e) => [
            (e.resolvedAt as Date).toISOString(),
            `対応済みにした（${e.resolvedByName ?? "−"}）${e.resolutionNote ? `　メモ: ${e.resolutionNote}` : ""}`,
          ])
      ),
    ].map(([at, text]) => ({ at, text })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border p-4 text-sm ${open.length > 0 ? "border-warning-line bg-warning-soft" : "border-line bg-surface"}`}
    >
      <h2 className="font-bold">例外（B-02）</h2>
      <ul className="flex flex-col gap-1">
        {exceptions.map((e) => (
          <li key={e.id} className="flex flex-wrap items-start gap-2">
            <span className="flex-1">
              {e.status === "open" ? "⚠ " : ""}
              <span className="font-bold">{ORDER_EXCEPTION_RULES[e.rule]}</span>：{e.reason}
              {!e.stillMatches && <span className="ml-1 text-ink-muted">※取り込み直しで直った可能性があります</span>}
            </span>
            {e.status === "open" ? <Badge tone="warning">未対応</Badge> : <Badge tone="success">対応済み</Badge>}
          </li>
        ))}
      </ul>
      <ResolveExceptionsForm action={resolveOrderExceptionsAction.bind(null, orderId)} hasOpen={open.length > 0} />
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <p className="font-bold text-ink-muted">履歴</p>
        <ul className="flex flex-col gap-0.5 text-ink-muted">
          {history.map((h) => (
            <li key={`${h.at}-${h.text}`} className="tabular-nums">
              {formatDateTime(h.at)} {h.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
