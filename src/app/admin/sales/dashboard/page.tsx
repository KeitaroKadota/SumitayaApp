import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { getLatestForecastRun } from "@/utils/forecastServer";
import { formatDate, formatDateTime, formatPercent, formatQuantity, formatYen } from "@/utils/format";
import {
  INVENTORY_KPI_DEFAULTS,
  KPI_PAGE_SIZE,
  countNegativeStock,
  getKpiRows,
  hasKpiForDate,
  listStagnant,
  listStockout,
  recordInventoryKpi,
  staleDaysOf,
} from "@/utils/inventoryKpi";
import { todayJST } from "@/utils/jst";
import { diffDays } from "@/utils/salesPeriod";
import { Alert } from "@/components/Alert";
import { EmptyState } from "@/components/EmptyState";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { SubmitButton } from "@/components/SubmitButton";
import { recordKpiAgain } from "./actions";
import { TrendChart } from "./TrendChart";

const BASE = "/admin/sales/dashboard";
const RANGES = [30, 90, 365] as const;

// G01 在庫の指標(A-05 EV-01・EV-03)
export default async function InventoryKpiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // 手順1
  await requireAccess("sales", BASE);
  const today = todayJST();
  // CH-03 表示の条件(だめなら既定)
  const rangeParam = Number(params.range);
  const range = (RANGES as readonly number[]).includes(rangeParam) ? rangeParam : 30;
  const tab = params.tab === "stockout" ? "stockout" : "stagnant";
  const pageNum = Number(params.page);
  const page = Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1;
  const url = (p: { range?: number; tab?: string; page?: number }) =>
    `${BASE}?${new URLSearchParams({ range: String(p.range ?? range), tab: p.tab ?? tab, page: String(p.page ?? 1) })}`;

  // 手順2 今日の記録が無ければ記録する(失敗しても画面は出す)
  let recordFailed = false;
  try {
    if (!(await hasKpiForDate(today))) {
      const r = await recordInventoryKpi(today);
      if (!r.ok && r.reason !== "在庫数がありません") recordFailed = true;
    }
  } catch (e) {
    console.error("在庫の指標を記録できませんでした:", e instanceof Error ? e.message : e);
    recordFailed = true;
  }

  // 手順3・4
  const { latest, trend } = await getKpiRows(today, range);
  // 手順5 記録が1件も無い
  if (!latest)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">在庫の指標</h1>
        {recordFailed && <Alert tone="error">今日の数字を記録できませんでした。</Alert>}
        <EmptyState message="在庫を取り込むと、ここに指標が出ます（B-01）。" action={<LinkButton href="/admin/inventory/import">在庫を取り込む</LinkButton>} />
      </div>
    );

  const list = tab === "stagnant" ? await listStagnant(today, page) : await listStockout(today, page);
  const negative = await countNegativeStock();
  const run = await getLatestForecastRun();
  const stale = staleDaysOf(latest.inventoryAsOf, today);
  const k = INVENTORY_KPI_DEFAULTS;
  const productLink = (productId: string, label: string) =>
    run ? (
      <Link href={`/admin/forecast/${run.id}/products/${productId}`} className="font-bold text-primary hover:underline">
        {label}
      </Link>
    ) : (
      label
    );
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          在庫の指標 {formatDate(latest.kpiDate)}
          <span className="ml-2 text-sm font-normal text-ink-muted">
            （在庫 {latest.inventoryAsOf ? `${formatDateTime(latest.inventoryAsOf)} 時点` : "−"}）
          </span>
        </h1>
        <form action={recordKpiAgain}>
          <SubmitButton variant="secondary" pendingText="記録中…">
            今日の数字を記録し直す
          </SubmitButton>
        </form>
      </div>

      {str("recorded") && <Alert tone="success">今日の数字を記録し直しました。</Alert>}
      {(recordFailed || str("record_failed")) && <Alert tone="error">今日の数字を記録できませんでした。</Alert>}
      {latest.kpiDate !== today && <Alert tone="warning">今日の記録がないため、{formatDate(latest.kpiDate)} の数字を出しています。</Alert>}
      {stale !== null && stale >= k.staleDays && <Alert tone="warning">在庫数が {stale} 日前のものです。</Alert>}
      {latest.missingCostCount > 0 && <Alert tone="warning">原価が未登録の商品 {formatQuantity(latest.missingCostCount)}件は金額に入っていません。</Alert>}
      {negative > 0 && <Alert tone="warning">在庫がマイナスの商品 {formatQuantity(negative)}件（0として数えています）</Alert>}

      <div className="grid gap-3 md:grid-cols-3">
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">在庫回転率</h2>
          <p className="text-2xl font-bold tabular-nums">{latest.turnover !== null ? `${latest.turnover.toFixed(2)} 回転` : "−"}</p>
          <p className="text-sm text-ink-muted">
            基準 {k.turnoverBaseline.toFixed(2)} → 目標 {k.turnoverTarget.toFixed(2)}
          </p>
          {latest.kpiDays < k.turnoverDays && <p className="text-xs text-ink-muted">記録 {formatQuantity(latest.kpiDays)}日分の平均で計算しています</p>}
        </section>
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">滞留在庫金額</h2>
          <p className="text-2xl font-bold tabular-nums">{formatYen(latest.stagnantValue)}</p>
          <p className="text-sm text-ink-muted">（原価・税抜）{k.stagnantDays}日以上売れていない {formatQuantity(latest.stagnantCount)}品</p>
        </section>
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">欠品率</h2>
          <p className="text-2xl font-bold tabular-nums">{latest.stockoutRate !== null ? formatPercent(latest.stockoutRate) : "−"}</p>
          <p className="text-sm text-ink-muted">
            対象 {formatQuantity(latest.targetCount)}品中 {formatQuantity(latest.stockoutCount)}品
          </p>
        </section>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold">推移</h2>
          {RANGES.map((r) => (
            <LinkButton key={r} href={url({ range: r, page })} variant={range === r ? "primary" : "secondary"}>
              {r === 365 ? "1年" : `${r}日`}
            </LinkButton>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TrendChart
            title="在庫金額（原価・税抜）"
            points={trend.map((t) => ({ date: t.kpiDate, value: t.totalValue }))}
            format={(v) => formatYen(Math.round(v))}
          />
          <TrendChart title="欠品率" points={trend.map((t) => ({ date: t.kpiDate, value: t.stockoutRate }))} format={(v) => formatPercent(v)} />
        </div>
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="一覧の切り替え">
        <LinkButton href={url({ tab: "stagnant" })} variant={tab === "stagnant" ? "primary" : "secondary"}>
          滞留在庫の一覧
        </LinkButton>
        <LinkButton href={url({ tab: "stockout" })} variant={tab === "stockout" ? "primary" : "secondary"}>
          欠品中の商品
        </LinkButton>
      </nav>

      {list.rows.length === 0 ? (
        <EmptyState message={tab === "stagnant" ? "滞留在庫はありません。" : "欠品中の商品はありません。"} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              {tab === "stagnant" ? (
                <tr>
                  <th className="px-3 py-2">コード</th>
                  <th className="px-3 py-2">商品名</th>
                  <th className="px-3 py-2">ランク</th>
                  <th className="px-3 py-2 text-right">在庫</th>
                  <th className="px-3 py-2 text-right">原価（円）</th>
                  <th className="px-3 py-2 text-right">金額（円）</th>
                  <th className="px-3 py-2">最後に売れた日</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-3 py-2">コード</th>
                  <th className="px-3 py-2">商品名</th>
                  <th className="px-3 py-2">ランク</th>
                  <th className="px-3 py-2 text-right">在庫</th>
                  <th className="px-3 py-2 text-right">直近90日の販売数</th>
                </tr>
              )}
            </thead>
            <tbody>
              {tab === "stagnant"
                ? (list.rows as Awaited<ReturnType<typeof listStagnant>>["rows"]).map((r) => (
                    <tr key={r.productId} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 tabular-nums">{r.productCode}</td>
                      <td className="px-3 py-2">{productLink(r.productId, r.name)}</td>
                      <td className="px-3 py-2">{r.abcRank ?? "−"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.costPrice ? formatQuantity(r.costPrice) : "未登録"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.value)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {r.lastSold ? `${formatDate(r.lastSold)}（${formatQuantity(diffDays(r.lastSold, today))}日前）` : "売れた記録なし"}
                      </td>
                    </tr>
                  ))
                : (list.rows as Awaited<ReturnType<typeof listStockout>>["rows"]).map((r) => (
                    <tr key={r.productId} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 tabular-nums">{r.productCode}</td>
                      <td className="px-3 py-2">{productLink(r.productId, r.name)}</td>
                      <td className="px-3 py-2">{r.abcRank ?? "−"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.sold90)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={list.total} page={page} pageSize={KPI_PAGE_SIZE} hrefOf={(p) => url({ page: p })} />
      <p className="text-xs text-ink-muted">在庫の金額はすべて原価（税抜）です。</p>
    </div>
  );
}
