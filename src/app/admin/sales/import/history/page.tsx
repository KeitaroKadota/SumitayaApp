import { requireAccess } from "@/utils/auth";
import { SALES_KINDS, salesKindOf, type SalesImportKind } from "@/utils/csvImport/kinds/salesColumns";
import { formatDateShort, formatQuantity, formatTime } from "@/utils/format";
import { SALES_HISTORY_PAGE_SIZE, listSalesBatches, type SalesBatchSummary } from "@/utils/salesImport";
import { Alert } from "@/components/Alert";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge, type BadgeTone } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { BackLink } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { cancelSalesImport } from "./actions";

const ERRORS: Record<string, string> = {
  notfound: "この取り込みは見つかりません。",
  status: "この取り込みは登録済みではないので取消できません。",
  owner: "取消できるのは、取り込んだ本人と社長だけです。",
  failed: "取消できませんでした。何も変えていません。もう一度お試しください。",
};

// 状態の札(02 G03)。確認中で1日たったものは「期限切れ」
const statusOf = (b: SalesBatchSummary): { label: string; tone: BadgeTone } => {
  if (b.status === "applied") return { label: "登録済み", tone: "success" };
  if (b.status === "cancelled") return { label: "取消", tone: "neutral" };
  if (b.status === "failed") return { label: "失敗", tone: "danger" };
  return b.expired
    ? { label: "期限切れ", tone: "neutral" }
    : { label: "確認中", tone: "warning" };
};

// G03 取り込みの記録(A-01 EV-05)
export default async function SalesImportHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // 手順1
  const me = await requireAccess("sales", "/admin/sales/import/history");
  const kindParam = typeof params.kind === "string" ? params.kind : "";
  const kind = salesKindOf(kindParam)?.kind ?? "";
  const pageNum = Number(params.page);
  const page = Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1;

  // 手順2 種類(A-01 の画面では sales_*)で絞り、新しい順に50件ずつ
  const kinds: SalesImportKind[] = kind ? [kind] : SALES_KINDS.map((k) => k.kind);
  const { total, batches } = await listSalesBatches(kinds, page);
  const error = typeof params.error === "string" ? ERRORS[params.error] : null;
  const cancelled = typeof params.cancelled === "string" ? params.cancelled : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/sales/import" label="売上の取り込みへ" />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">取り込みの記録</h1>
        <form method="get">
          <label htmlFor="kind" className="flex flex-col gap-1 text-sm font-bold">
            種類
            <AutoSubmitSelect id="kind" name="kind" defaultValue={kind} className="w-64">
              <option value="">売上（すべて）</option>
              {SALES_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </AutoSubmitSelect>
          </label>
        </form>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {cancelled !== null && <Alert tone="success">取消しました（売上 {formatQuantity(Number(cancelled))}件を消しました）。</Alert>}
      <p className="text-sm text-ink-muted">
        取消すると、この取り込みで入れた売上を消します。上書き・削除した前の値は戻りません。前の状態に戻すときは、前のファイルを取り込み直してください。
      </p>

      {batches.length === 0 ? (
        <EmptyState message="取り込みの記録はまだありません。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">日時</th>
                <th className="px-3 py-2">種類</th>
                <th className="px-3 py-2">ファイル</th>
                <th className="px-3 py-2">期間</th>
                <th className="px-3 py-2">件数</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2">取り込んだ人</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const st = statusOf(b);
                const c = b.counts;
                const canCancel = b.status === "applied" && (b.appliedBy === me.id || me.roles.includes("president"));
                return (
                  <tr key={b.id} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {formatDateShort(b.createdAt)} {formatTime(b.createdAt)}
                    </td>
                    <td className="px-3 py-2">{salesKindOf(b.kind)?.label ?? b.kind}</td>
                    <td className="px-3 py-2 break-all">{b.source === "api" ? "自動（API）" : b.fileName}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {b.periodFrom && b.periodTo ? `${formatDateShort(b.periodFrom)}〜${formatDateShort(b.periodTo)}` : "−"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      追{formatQuantity(c.add)} 変{formatQuantity(c.change)} 削{formatQuantity(c.delete)} 誤{formatQuantity(c.error)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-3 py-2">{b.appliedByName ?? b.createdByName ?? "−"}</td>
                    <td className="px-3 py-2">
                      {canCancel && (
                        <form action={cancelSalesImport.bind(null, b.id)}>
                          <ConfirmSubmitButton
                            variant="secondary"
                            pendingText="取消中…"
                            confirmMessage="この取り込みで入れた売上を消します。上書き・削除した前の値は戻りません。"
                          >
                            取消
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        total={total}
        page={page}
        pageSize={SALES_HISTORY_PAGE_SIZE}
        hrefOf={(p) => `/admin/sales/import/history?${new URLSearchParams({ ...(kind ? { kind } : {}), page: String(p) })}`}
      />
    </div>
  );
}
