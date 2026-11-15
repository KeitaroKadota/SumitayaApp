import { requireAccess } from "@/utils/auth";
import { SALES_CHANNELS, type SalesChannel } from "@/utils/csvImport/kinds/salesColumns";
import { formatDateShort, formatPercent, formatQuantity, formatYen } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { SALES_UNITS, getSalesOverview, parseSalesFilter, type SalesUnit } from "@/utils/salesData";
import { yearMonthLabel } from "@/utils/salesPeriod";
import { countUnlinkedSalesCodes } from "@/utils/salesRelink";
import { Alert } from "@/components/Alert";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { relinkSales } from "./actions";

// 表の行の見出し(月は YYYY年M月、週・日は MM/DD（曜）。週は月曜の日付)
const bucketLabel = (bucket: string, unit: SalesUnit) => (unit === "month" ? yearMonthLabel(bucket.slice(0, 7)) : formatDateShort(bucket));

// G01 売上の一覧(A-01 EV-08)
export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // 手順1
  await requireAccess("sales", "/admin/sales");
  // 手順2 CH-13
  const { filter, adjusted } = parseSalesFilter(params, todayJST());

  // 手順3〜5
  let overview: Awaited<ReturnType<typeof getSalesOverview>> | null = null;
  let unlinked = 0;
  let loadError = false;
  try {
    overview = await getSalesOverview(filter);
    unlinked = await countUnlinkedSalesCodes();
  } catch (e) {
    console.error("売上を読み込めませんでした:", e instanceof Error ? e.message : e);
    loadError = true;
  }

  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const relinked = str("relinked");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">売上</h1>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/admin/sales/import" variant="primary">
            売上を取り込む
          </LinkButton>
          <LinkButton href="/admin/sales/import/history">取り込みの記録</LinkButton>
        </div>
      </div>

      {relinked !== null && (
        <Alert tone="success">
          {formatQuantity(Number(str("before")))}件のうち {formatQuantity(Number(relinked))}件を結び付けました。残り{" "}
          {formatQuantity(Number(str("remaining")))}件はマスタにありません。
        </Alert>
      )}
      {str("relink_failed") && <Alert tone="error">結び付けをやり直せませんでした。もう一度お試しください。</Alert>}
      {adjusted && <Alert tone="warning">表示の条件が正しくないため、直近12か月・月ごとで表示しています（期間は3年以内、日ごとは92日以内）。</Alert>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="from" label="期間（始め）">
          <TextInput id="from" name="from" type="date" defaultValue={filter.from} className="w-44" />
        </Field>
        <Field id="to" label="期間（終わり）">
          <TextInput id="to" name="to" type="date" defaultValue={filter.to} className="w-44" />
        </Field>
        <Field id="unit" label="まとめ方">
          <Select id="unit" name="unit" defaultValue={filter.unit} className="w-28">
            {(Object.keys(SALES_UNITS) as SalesUnit[]).map((u) => (
              <option key={u} value={u}>
                {SALES_UNITS[u]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="channel" label="販路">
          <Select id="channel" name="channel" defaultValue={filter.channel} className="w-36">
            <option value="">すべて</option>
            {(Object.keys(SALES_CHANNELS) as SalesChannel[]).map((c) => (
              <option key={c} value={c}>
                {SALES_CHANNELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="q" label="商品">
          <TextInput id="q" name="q" defaultValue={filter.q} placeholder="コード・名前で探す" className="w-56" />
        </Field>
        <SubmitButton pendingText="表示中…">表示</SubmitButton>
      </form>

      {loadError || !overview ? (
        <Alert tone="error">売上を読み込めませんでした。時間をおいてもう一度お試しください。</Alert>
      ) : (
        <>
          <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 text-sm">
            <h2 className="font-bold">合計</h2>
            <p className="tabular-nums">
              数量 {formatQuantity(overview.totals.quantity, "点")}　売上 {formatYen(overview.totals.amountInclTax, "included")}　明細{" "}
              {formatQuantity(overview.totals.lineCount, "件")}
            </p>
            <p className="text-ink-muted">
              取り込んである期間:{" "}
              {overview.coverage.length === 0
                ? "まだ売上がありません"
                : overview.coverage
                    .map(
                      (c) =>
                        `${SALES_CHANNELS[c.channel]} ${yearMonthLabel(c.firstMonth)}〜${yearMonthLabel(c.lastMonth)}${
                          c.missing.length > 0 ? `（${c.missing.map(yearMonthLabel).join("・")} が無い）` : ""
                        }`
                    )
                    .join(" / ")}
            </p>
          </section>

          {overview.periods.length === 0 ? (
            <EmptyState message="この条件の売上はありません。" action={<LinkButton href="/admin/sales/import">売上を取り込む</LinkButton>} />
          ) : (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold">売上（円・税込）</h2>
              <div className="overflow-x-auto rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-canvas text-left">
                    <tr>
                      <th className="px-3 py-2">{SALES_UNITS[filter.unit]}</th>
                      {overview.channels.map((c) => (
                        <th key={c} className="px-3 py-2 text-right">
                          {SALES_CHANNELS[c]}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.periods.map((p) => (
                      <tr key={p.bucket} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{bucketLabel(p.bucket, filter.unit)}</td>
                        {overview.channels.map((c) => (
                          <td key={c} className="px-3 py-2 text-right tabular-nums">
                            {p.byChannel[c] !== undefined ? formatQuantity(p.byChannel[c] as number) : "−"}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-bold tabular-nums">{formatQuantity(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {overview.products.length > 0 && (
            <details className="rounded-lg border border-line bg-surface p-4" open>
              <summary className="cursor-pointer font-bold">商品別（売上の多い順・上位100）</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-canvas text-left">
                    <tr>
                      <th className="px-3 py-2">コード</th>
                      <th className="px-3 py-2">商品名</th>
                      <th className="px-3 py-2 text-right">数量</th>
                      <th className="px-3 py-2 text-right">売上（円・税込）</th>
                      <th className="px-3 py-2">販路の内訳</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.products.map((p) => (
                      <tr key={p.code} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-2 tabular-nums">{p.code}</td>
                        <td className={`px-3 py-2 ${p.linked ? "" : "text-ink-muted"}`}>
                          {p.linked ? p.name : `（マスタに無い）${p.name ?? ""}`}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(p.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(p.amountInclTax)}</td>
                        <td className="px-3 py-2 text-xs">
                          {p.shares.map((s) => `${SALES_CHANNELS[s.channel]} ${formatPercent(s.ratio)}`).join("・")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {unlinked > 0 && (
        <form action={relinkSales} className="flex flex-wrap items-center gap-3">
          <Alert tone="warning" className="flex-1">
            マスタに無い商品コード {formatQuantity(unlinked)}件
          </Alert>
          <SubmitButton variant="secondary" pendingText="結び付け中…">
            商品の結び付けをやり直す
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
