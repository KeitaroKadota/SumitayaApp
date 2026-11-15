import { notFound } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { FORECAST_DEFAULTS } from "@/utils/forecast";
import { getForecastDetail } from "@/utils/forecastServer";
import { formatDateShort, formatDateTime, formatQuantity } from "@/utils/format";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { BackLink } from "@/components/LinkButton";

const BASIS: Record<string, string> = { product: "この商品で計算", category: "同じ分類の商品で計算", store: "店全体で計算" };
const DESTINATION: Record<string, string> = { purchase: "仕入先へ発注", production: "工場で作る候補", no_supplier: "仕入先が未登録" };

// G02 商品ごとの予測の詳細(判断の理由)(A-03 EV-04)
export default async function ForecastDetailPage({ params }: { params: Promise<{ runId: string; productId: string }> }) {
  const { runId, productId } = await params;
  // 手順1
  await requireAccess("sales", `/admin/forecast/${runId}/products/${productId}`);
  // 手順2・3
  const d = await getForecastDetail(runId, productId);
  if (!d) notFound();
  const s = d.suggestion;
  const g = d.weeks[0];
  const range = FORECAST_DEFAULTS.growthRange;

  // 手順4 「判断」の文(replenishment_suggestions の理由と途中の数から組み立てる)
  const decision: string[] = [];
  if (s) {
    const available = s.onHandQty + s.onOrderQty;
    decision.push(`${s.reason}（使える在庫 ${available} ＝ 在庫 ${s.onHandQty} ＋ 発注残 ${s.onOrderQty}）。`);
    decision.push(`発注点 ${s.reorderPoint} ＝ リードタイム ${s.leadTimeDays}日の予測 ${s.leadTimeDemand} ＋ 安全在庫 ${s.safetyStock}`);
    const safetyWeeks = FORECAST_DEFAULTS.safetyWeeks[s.abcRank ?? "B"];
    decision.push(`安全在庫 ${s.safetyStock} ＝ 1週あたりの予測 × 安全の週数 ${safetyWeeks.toFixed(1)}（${s.abcRank ?? "ランク無し＝B"}ランク）`);
    if (s.suggestedQty > 0)
      decision.push(
        `提案数 ${s.suggestedQty} ＝（リードタイム＋発注の間隔 ${s.reviewWeeks}週）の予測 ＋ 安全在庫 ${s.safetyStock} − 使える在庫 ${available}` +
          `${s.orderLot && s.orderLot > 1 ? ` → 発注の単位 ${s.orderLot} に切り上げ` : ""}${s.minOrderQty ? `（最低の発注数 ${s.minOrderQty}）` : ""}`
      );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/forecast" label="予測と発注の提案へ" />
      </div>
      <h1 className="text-2xl font-bold">
        {d.product.name}（{d.product.code}）
      </h1>
      <p className="text-sm">
        ランク {s?.abcRank ?? "−"}　仕入先 {d.supplierName ?? "−"}　リードタイム {s ? `${s.leadTimeDays}日` : "−"}　{s ? DESTINATION[s.destination] : ""}
      </p>
      <p className="text-xs text-ink-muted">{formatDateTime(d.runCreatedAt)} の計算</p>

      {s && (
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
          <h2 className="font-bold">判断</h2>
          {decision.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </section>
      )}
      {d.tooLargeWeeks.length > 0 && (
        <Alert tone="warning">予測が大きすぎるかもしれません（{d.tooLargeWeeks.map(formatDateShort).join("・")} の週。去年の同じ時期の最大の週の3倍を超えています）</Alert>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left">
            <tr>
              <th className="px-3 py-2">週（月曜）</th>
              <th className="px-3 py-2 text-right">去年の実績</th>
              <th className="px-3 py-2 text-right">基準</th>
              <th className="px-3 py-2">祭り</th>
              <th className="px-3 py-2 text-right">伸び率</th>
              <th className="px-3 py-2 text-right">補正</th>
              <th className="px-3 py-2 text-right">予測</th>
            </tr>
          </thead>
          <tbody>
            {d.weeks.map((w) => (
              <tr key={w.weekStart} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDateShort(w.weekStart)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.method === "last_year" ? formatQuantity(w.lastYearActual) : "−"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.baseQty.toFixed(1)}</td>
                <td className="px-3 py-2">
                  {w.festivalName
                    ? `${w.festivalName}${w.shiftDays !== FORECAST_DEFAULTS.lastYearShiftDays ? `（${w.shiftDays - FORECAST_DEFAULTS.lastYearShiftDays}日ずらし）` : ""}${w.festivalFactor !== 1 ? ` ×${w.festivalFactor.toFixed(2)}` : ""}`
                    : "−"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{w.growthRate.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{w.biasFactor.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">
                  {formatQuantity(w.forecastQty)}
                  {d.tooLargeWeeks.includes(w.weekStart) && <span className="ml-1 text-warning">⚠</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {g && (
        <section className="flex flex-col gap-1 text-sm">
          {g.method === "last_year" ? (
            <>
              <p>
                伸び率: {g.growthBasis === "product" ? `直近12週 ${formatQuantity(d.growthRecent)} ÷ 去年の同じ12週 ${formatQuantity(d.growthLastYear)} ＝ ` : ""}
                {g.growthRate.toFixed(2)}（{BASIS[g.growthBasis]}）
                {(g.growthRate === range.max || g.growthRate === range.min) && (
                  <span className="ml-1">
                    <Badge tone="warning">{g.growthRate === range.max ? "上限" : "下限"}</Badge>
                  </span>
                )}
              </p>
              <p>
                補正: {d.biasForecast > 0 ? `直近8週の実績 ${formatQuantity(d.biasActual)} ÷ 予測 ${formatQuantity(d.biasForecast)} ＝ ` : "比べる予測が無いため "}
                {g.biasFactor.toFixed(2)}
              </p>
            </>
          ) : (
            <p>去年の記録が無いため、直近8週の1週あたりの平均（{g.baseQty.toFixed(1)}）を毎週の予測にしています。</p>
          )}
        </section>
      )}
    </div>
  );
}
