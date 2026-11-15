import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatQuantity } from "@/utils/format";
import { PO_STATUSES, type PoStatus } from "@/utils/purchaseOrderRules";
import { PO_PAGE_SIZE, listPurchaseOrders, listSupplierOptions, parsePoListFilter } from "@/utils/purchaseOrdersAdmin";
import { Alert } from "@/components/Alert";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Modal } from "@/components/Modal";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { createManualAction } from "./actions";

const LIST = "/admin/purchase-orders";

// G05 発注の一覧(A-03 EV-16・EV-08)
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // 手順1
  await requireAccess("sales", LIST);
  // 手順2 条件(状態・仕入先・期間)で、新しい順に50件ずつ
  const filter = parsePoListFilter(params);
  const [{ total, rows }, suppliers] = [await listPurchaseOrders(filter), await listSupplierOptions()];
  const query = (page: number) =>
    `${LIST}?${new URLSearchParams({ status: filter.status, supplier: filter.supplierId, from: filter.from, to: filter.to, page: String(page) })}`;
  const created = typeof params.created === "string" ? params.created : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">発注</h1>
        <LinkButton href={`${LIST}?new=1`} variant="primary">
          手で発注を作る
        </LinkButton>
      </div>
      {created && <Alert tone="success">発注の下書きを {formatQuantity(Number(created))}件作りました。</Alert>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="status" label="状態">
          <Select id="status" name="status" defaultValue={filter.status} className="w-56">
            <option value="open">未完了（下書き〜一部入荷）</option>
            <option value="all">すべて</option>
            {(Object.keys(PO_STATUSES) as PoStatus[]).map((s) => (
              <option key={s} value={s}>
                {PO_STATUSES[s]}
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
        <Field id="from" label="期間（始め）">
          <TextInput id="from" name="from" type="date" defaultValue={filter.from} className="w-44" />
        </Field>
        <Field id="to" label="期間（終わり）">
          <TextInput id="to" name="to" type="date" defaultValue={filter.to} className="w-44" />
        </Field>
        <SubmitButton pendingText="表示中…">表示</SubmitButton>
      </form>

      {rows.length === 0 ? (
        <EmptyState message="この条件の発注はありません。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">発注番号</th>
                <th className="px-3 py-2">仕入先</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2 text-right">明細</th>
                <th className="px-3 py-2 text-right">金額（円・税抜）</th>
                <th className="px-3 py-2">発注日</th>
                <th className="px-3 py-2">入荷予定</th>
                <th className="px-3 py-2">作成者</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 tabular-nums">
                    <Link href={`${LIST}/${r.id}`} className="font-bold text-primary hover:underline">
                      {r.orderNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.supplierName}</td>
                  <td className="px-3 py-2">{PO_STATUSES[r.status]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.lineCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(r.subtotal)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.orderDate ? formatDateShort(r.orderDate) : "−"}</td>
                  <td className="px-3 py-2 tabular-nums">{r.expectedDate ? formatDateShort(r.expectedDate) : "−"}</td>
                  <td className="px-3 py-2">{r.createdByName ?? "−"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination total={total} page={filter.page} pageSize={PO_PAGE_SIZE} hrefOf={query} />

      {params.new === "1" && (
        <Modal title="手で発注を作る" closeHref={LIST} size="md">
          <form action={createManualAction} className="flex flex-col gap-4">
            {params.error === "supplier" && <Alert tone="error">取引中の仕入先を選んでください。</Alert>}
            <Field id="supplier_id" label="仕入先" required>
              <Select id="supplier_id" name="supplier_id" required defaultValue="">
                <option value="" disabled>
                  選んでください
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <SubmitButton pendingText="作成中…">下書きを作る</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
