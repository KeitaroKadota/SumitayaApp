import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { ABC_RANKS } from "@/utils/abc";
import { getAbcOverview } from "@/utils/abcServer";
import { formatDate, formatDateShort, formatPercent, formatQuantity, formatTime } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { getSalesDateRange } from "@/utils/salesData";
import { lastTwelveMonths, yearMonthLabel } from "@/utils/salesPeriod";
import { Alert } from "@/components/Alert";
import { EmptyState } from "@/components/EmptyState";
import { runAbcAction } from "./actions";
import { AbcCalcForm } from "./AbcCalcForm";

// 計算に時間がかかるため(商品数 約17,000点。A-02 7章)
export const maxDuration = 120;

// G01 ABC分析(A-02 EV-01)
export default async function AbcPage() {
  // 手順1
  await requireAccess("sales", "/admin/sales/abc");
  // 手順2 期間の既定(直近12か月。ABC_SETTINGS.periodMonths)
  const def = lastTwelveMonths(todayJST());

  // 手順3〜5
  let range: Awaited<ReturnType<typeof getSalesDateRange>> = { first: null, last: null };
  let overview: Awaited<ReturnType<typeof getAbcOverview>> | null = null;
  try {
    range = await getSalesDateRange();
    overview = await getAbcOverview();
  } catch (e) {
    console.error("ABC分析の画面を読み込めませんでした:", e instanceof Error ? e.message : e);
  }
  const rangeText = range.first && range.last ? `${formatDate(range.first)}〜${formatDate(range.last)}` : "まだ売上がありません";
  const productTotal = overview ? ABC_RANKS.reduce((s, r) => s + overview.rankCounts[r], 0) + overview.rankCounts.none : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">ABC分析</h1>
      <AbcCalcForm action={runAbcAction} defaultFrom={def.from} defaultTo={def.to} salesRangeText={rangeText} />

      {!overview ? (
        <Alert tone="error">データを読み込めませんでした。時間をおいてもう一度お試しください。</Alert>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">
              今の商品マスタのランク{overview.lastRankedAt ? `（${formatDate(overview.lastRankedAt)}反映）` : ""}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-canvas text-left">
                  <tr>
                    <th className="px-3 py-2">ランク</th>
                    <th className="px-3 py-2 text-right">商品数</th>
                    <th className="px-3 py-2 text-right">販売金額の割合</th>
                    <th className="px-3 py-2 text-right">出荷頻度の割合</th>
                  </tr>
                </thead>
                <tbody>
                  {ABC_RANKS.map((r) => (
                    <tr key={r} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 font-bold">{r}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatQuantity(overview.rankCounts[r])}（{formatPercent(productTotal > 0 ? overview.rankCounts[r] / productTotal : 0)}）
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{overview.shares ? formatPercent(overview.shares[r].amount) : "−"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{overview.shares ? formatPercent(overview.shares[r].frequency) : "−"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-ink-muted">ランク無し {formatQuantity(overview.rankCounts.none)}（新しく登録した商品など）</p>
            {overview.shares && (
              // 販売金額の割合の簡単な棒(A・B・C の順)
              <div className="flex h-4 w-full overflow-hidden rounded border border-line" aria-label="販売金額の割合">
                <div className="bg-primary" style={{ width: `${overview.shares.A.amount * 100}%` }} title="A" />
                <div className="bg-primary-soft" style={{ width: `${overview.shares.B.amount * 100}%` }} title="B" />
                <div className="bg-canvas" style={{ width: `${overview.shares.C.amount * 100}%` }} title="C" />
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">計算の記録</h2>
            {overview.runs.length === 0 ? (
              <EmptyState message="計算の記録はまだありません。" />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-canvas text-left">
                    <tr>
                      <th className="px-3 py-2">日時</th>
                      <th className="px-3 py-2">期間</th>
                      <th className="px-3 py-2 text-right">A / B / C</th>
                      <th className="px-3 py-2">状態</th>
                      <th className="px-3 py-2">計算した人</th>
                      <th className="px-3 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.runs.map((r) => (
                      <tr key={r.id} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {formatDateShort(r.createdAt)} {formatTime(r.createdAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {yearMonthLabel(r.periodFrom.slice(0, 7))}〜{yearMonthLabel(r.periodTo.slice(0, 7))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatQuantity(r.summary.A ?? 0)}/{formatQuantity(r.summary.B ?? 0)}/{formatQuantity(r.summary.C ?? 0)}
                        </td>
                        <td className="px-3 py-2">{r.status === "applied" ? "反映済み" : r.status}</td>
                        <td className="px-3 py-2">{r.createdByName ?? "−"}</td>
                        <td className="px-3 py-2">
                          <Link href={`/admin/sales/abc/${r.id}`} className="font-bold text-primary hover:underline">
                            見る
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
