import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import {
  checkForecastPrereq,
  countSuggestionsByTab,
  getLatestForecastRun,
  listSuggestions,
  type SuggestionRow,
  type SuggestionTab,
} from "@/utils/forecastServer";
import { formatDate, formatDateTime, formatQuantity, formatYen } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { SEND_METHODS, isSendMethod } from "@/utils/purchaseOrderRules";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { LinkButton } from "@/components/LinkButton";
import { createDraftsAction, runForecastAction } from "./actions";
import { DraftCreateForm, ForecastRunForm } from "./ForecastForms";

// 予測の計算は数十秒かかることがある(A-03 7章「maxDuration を設定」)
export const maxDuration = 300;

const TABS: { key: SuggestionTab; label: string }[] = [
  { key: "purchase", label: "仕入先ごと" },
  { key: "production", label: "工場で作る候補" },
  { key: "no_supplier", label: "仕入先が未登録" },
  { key: "all", label: "すべての商品" },
];

function SuggestionTable({ rows, runId, selectable }: { rows: SuggestionRow[]; runId: string; selectable: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas text-left">
          <tr>
            {selectable && <th className="px-3 py-2">選ぶ</th>}
            <th className="px-3 py-2">コード</th>
            <th className="px-3 py-2">商品名</th>
            <th className="px-3 py-2">ランク</th>
            <th className="px-3 py-2 text-right">在庫</th>
            <th className="px-3 py-2 text-right">発注残</th>
            <th className="px-3 py-2 text-right">発注点</th>
            <th className="px-3 py-2 text-right">提案数</th>
            <th className="px-3 py-2">理由</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const muted = r.suggestedQty === 0;
            return (
              <tr key={r.id} className={`border-b border-line last:border-b-0 align-top ${muted ? "text-ink-muted" : ""}`}>
                {selectable && (
                  <td className="px-3 py-2">
                    {r.orderNo ? (
                      <span className="text-xs">下書き {r.orderNo}</span>
                    ) : (
                      <input
                        type="checkbox"
                        name="sid"
                        value={r.id}
                        defaultChecked={r.suggestedQty > 0}
                        disabled={r.suggestedQty === 0}
                        aria-label={`${r.productCode} を選ぶ`}
                        className="size-5 accent-primary"
                      />
                    )}
                  </td>
                )}
                <td className="px-3 py-2 tabular-nums">{r.productCode}</td>
                <td className="px-3 py-2">
                  <Link href={`/admin/forecast/${runId}/products/${r.productId}`} className="font-bold text-primary hover:underline">
                    {r.productName}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.abcRank ?? "−"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.onHandQty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.onOrderQty)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.reorderPoint)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{formatQuantity(r.suggestedQty)}</td>
                <td className="px-3 py-2 text-xs">
                  {r.reason}
                  {r.tooMany && (
                    <span className="ml-1">
                      <Badge tone="warning">多すぎるかもしれません</Badge>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// G01 予測と発注の提案(A-03 EV-01)
export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // 手順1
  await requireAccess("sales", "/admin/forecast");
  const today = todayJST();
  const tabParam = typeof params.tab === "string" ? params.tab : "";
  const tab: SuggestionTab = TABS.some((t) => t.key === tabParam) ? (tabParam as SuggestionTab) : "purchase";

  // 手順2・3 予測する期間・使うデータ・CH-01 の警告
  const prereq = await checkForecastPrereq(today);
  // 手順4・5 最新の回と提案
  const run = await getLatestForecastRun();
  const rows = run ? await listSuggestions(run.id, tab, today) : [];
  const counts = run ? await countSuggestionsByTab(run.id) : { production: 0, no_supplier: 0 };

  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const calculated = str("calculated");

  // 仕入先ごとにまとめる(仕入先ごとのタブ)
  const groups = new Map<string, SuggestionRow[]>();
  for (const r of rows) groups.set(r.supplierId ?? "", [...(groups.get(r.supplierId ?? "") ?? []), r]);
  const canSubmit = tab === "purchase" && rows.some((r) => r.suggestedQty > 0 && !r.orderNo);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">予測と発注の提案</h1>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/admin/forecast/festivals">祭礼カレンダー</LinkButton>
          <LinkButton href="/admin/purchase-orders">発注</LinkButton>
        </div>
      </div>

      {calculated !== null && (
        <Alert tone="success">
          {formatQuantity(Number(calculated))}商品を計算しました。発注が要る {formatQuantity(Number(str("need")))}・工場で作る候補{" "}
          {formatQuantity(Number(str("production")))}
          {Number(str("failed")) > 0 ? `（計算できなかった商品 ${formatQuantity(Number(str("failed")))}）` : ""}
        </Alert>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">計算する</h2>
        <p className="text-sm">
          予測する期間 12週（{formatDate(prereq.start)}〜{formatDate(prereq.end)}）
        </p>
        <p className="text-sm text-ink-muted">
          使うデータ: 売上 {prereq.salesFirst && prereq.salesLast ? `${formatDate(prereq.salesFirst)}〜${formatDate(prereq.salesLast)}` : "なし"} / 在庫{" "}
          {prereq.inventoryAsOf ? `${formatDateTime(prereq.inventoryAsOf)} 取り込み` : "なし"}
        </p>
        {prereq.errors.map((e) => (
          <Alert key={e} tone="error">
            {e}
          </Alert>
        ))}
        {prereq.warnings.map((w) => (
          <Alert key={w} tone="warning">
            {w}
          </Alert>
        ))}
        <ForecastRunForm action={runForecastAction} disabled={prereq.errors.length > 0} />
      </section>

      {!run ? (
        <EmptyState message="まだ予測を計算していません。「予測を計算する」を押してください。" />
      ) : (
        <>
          <p className="text-sm">
            前回の計算: {formatDateTime(run.createdAt)}（{run.createdByName ?? "−"}） 商品 {formatQuantity(run.summary.products ?? 0)} / 発注が要る{" "}
            {formatQuantity(run.summary.needOrder ?? 0)} / 工場で作る候補 {formatQuantity(run.summary.production ?? 0)}
          </p>
          {(run.summary.unlinkedSalesCodes ?? 0) > 0 && (
            <p className="text-sm text-ink-muted">マスタに無い商品の売上 {formatQuantity(run.summary.unlinkedSalesCodes ?? 0)}件は予測に入っていません。</p>
          )}

          <nav className="flex flex-wrap gap-2" aria-label="表示する提案">
            {TABS.map((t) => {
              const n = t.key === "production" ? counts.production : t.key === "no_supplier" ? counts.no_supplier : null;
              return (
                <LinkButton key={t.key} href={`/admin/forecast?tab=${t.key}`} variant={tab === t.key ? "primary" : "secondary"}>
                  {n !== null ? `${t.label}（${formatQuantity(n)}）` : t.label}
                </LinkButton>
              );
            })}
          </nav>

          {rows.length === 0 ? (
            <EmptyState message="この区分の提案はありません。" />
          ) : tab === "purchase" ? (
            <DraftCreateForm action={createDraftsAction} canSubmit={canSubmit}>
              {[...groups.entries()].map(([supplierId, list]) => {
                const head = list[0];
                const amount = list.reduce((s, r) => s + r.suggestedQty * (r.costPrice ?? 0), 0);
                const method = head.supplierOrderMethod && isSendMethod(head.supplierOrderMethod) ? SEND_METHODS[head.supplierOrderMethod] : null;
                return (
                  <details key={supplierId} open className="flex flex-col gap-2">
                    <summary className="cursor-pointer font-bold">
                      {head.supplierName ?? "（仕入先なし）"}（リードタイム {head.supplierLeadTime ?? "−"}日{method ? `・${method}` : ""}） 提案{" "}
                      {formatQuantity(list.filter((r) => r.suggestedQty > 0).length)}品 {formatYen(amount, "excluded")}
                    </summary>
                    <SuggestionTable rows={list} runId={run.id} selectable />
                  </details>
                );
              })}
            </DraftCreateForm>
          ) : (
            <SuggestionTable rows={rows} runId={run.id} selectable={false} />
          )}
          <p className="text-xs text-ink-muted">（商品名をクリックすると、予測の詳細（判断の理由）を開きます）</p>
        </>
      )}
    </div>
  );
}
