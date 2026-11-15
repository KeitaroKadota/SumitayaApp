import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { ABC_RANKS, type AbcRank } from "@/utils/abc";
import { ABC_RESULTS_PAGE_SIZE, getAbcRun, listAbcResults } from "@/utils/abcServer";
import { formatDate, formatDateTime, formatQuantity } from "@/utils/format";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";

const SCORE: Record<AbcRank, number> = { A: 3, B: 2, C: 1 };

// G02 計算の結果の詳細(A-02 EV-06)
export default async function AbcRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { runId } = await params;
  const sp = await searchParams;
  // 手順1
  await requireAccess("sales", `/admin/sales/abc/${runId}`);
  // 手順2 回と件数。無ければ G01 へ
  const run = await getAbcRun(runId);
  if (!run) redirect("/admin/sales/abc");

  // 手順3 条件(既定は「変わった商品だけ」)で、順位の順に100件ずつ
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const changedOnly = str("view") !== "all";
  const rankParam = str("rank");
  const rank = (ABC_RANKS as string[]).includes(rankParam) ? (rankParam as AbcRank) : "";
  const q = str("q").slice(0, 100);
  const pageNum = Number(str("page"));
  const page = Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1;
  const { total, rows } = await listAbcResults(run.id, { changedOnly, rank, q, page });
  const s = run.summary;
  const calculated = str("calculated");

  const hrefOf = (p: number) =>
    `/admin/sales/abc/${run.id}?${new URLSearchParams({ view: changedOnly ? "changed" : "all", rank, q, page: String(p) })}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/sales/abc" label="ABC分析へ" />
      </div>
      <h1 className="text-2xl font-bold">
        ABC分析の結果 {formatDate(run.periodFrom)}〜{formatDate(run.periodTo)}
      </h1>
      <p className="text-sm text-ink-muted">
        {formatDateTime(run.createdAt)} 計算・{run.status === "applied" ? "反映済み" : run.status}（{run.createdByName ?? "−"}）
      </p>
      {calculated && <Alert tone="success">計算して、{formatQuantity(Number(calculated))}商品のランクを変えました。</Alert>}
      {(s.warnings ?? []).map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}

      <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm tabular-nums">
        <p>
          A {formatQuantity(s.A ?? 0)} / B {formatQuantity(s.B ?? 0)} / C {formatQuantity(s.C ?? 0)} / マスタに無い{" "}
          {formatQuantity(s.unlinked ?? 0)} / 新商品 {formatQuantity(s.newProducts ?? 0)}
        </p>
        <p>
          前回からランクが変わった商品: {formatQuantity(s.changed ?? 0)}（上がった {formatQuantity(s.up ?? 0)}・下がった{" "}
          {formatQuantity(s.down ?? 0)}）
        </p>
      </section>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="view" label="絞り込み">
          <Select id="view" name="view" defaultValue={changedOnly ? "changed" : "all"} className="w-48">
            <option value="changed">変わった商品だけ</option>
            <option value="all">すべて</option>
          </Select>
        </Field>
        <Field id="rank" label="ランク">
          <Select id="rank" name="rank" defaultValue={rank} className="w-28">
            <option value="">すべて</option>
            {ABC_RANKS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="q" label="商品">
          <TextInput id="q" name="q" defaultValue={q} placeholder="コード・名前" className="w-56" />
        </Field>
        <SubmitButton pendingText="表示中…">表示</SubmitButton>
      </form>

      {rows.length === 0 ? (
        <EmptyState message="この条件の商品はありません。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2 text-right">順位</th>
                <th className="px-3 py-2">コード</th>
                <th className="px-3 py-2">商品名</th>
                <th className="px-3 py-2 text-right">金額（円・税抜）</th>
                <th className="px-3 py-2 text-right">累積（％）</th>
                <th className="px-3 py-2 text-right">回数</th>
                <th className="px-3 py-2">金</th>
                <th className="px-3 py-2">頻</th>
                <th className="px-3 py-2">総合</th>
                <th className="px-3 py-2">前回</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const changed = !!r.productId && r.previousRank !== r.rank;
                const arrow =
                  changed && r.previousRank ? (SCORE[r.rank] > SCORE[r.previousRank] ? "↑" : "↓") : changed ? "新" : "";
                return (
                  <tr key={r.productCode} className={`border-b border-line last:border-b-0 ${changed ? "bg-warning-soft" : ""}`}>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.order)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.productCode}</td>
                    <td className={`px-3 py-2 ${r.productId ? "" : "text-ink-muted"}`}>
                      {r.productId ? r.name : `（マスタに無い）${r.name ?? ""}`}
                      {r.isNewProduct && (
                        <span className="ml-1">
                          <Badge tone="ai">新</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.salesAmount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.amountCumShare.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.frequency)}</td>
                    <td className="px-3 py-2">{r.amountRank}</td>
                    <td className="px-3 py-2">{r.frequencyRank}</td>
                    <td className="px-3 py-2 font-bold">{r.rank}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.productId ? `${r.previousRank ?? "−"} ${arrow}` : <span className="text-xs text-ink-muted">反映できません</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} page={page} pageSize={ABC_RESULTS_PAGE_SIZE} hrefOf={hrefOf} />
    </div>
  );
}
