import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatClosingAndPayment, ORDER_METHODS } from "@/utils/masterRules";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { TextInput } from "@/components/TextInput";
import { listSuppliers } from "./supplierData";

// G07 仕入先の一覧(CMN-02 EV-14)。数十件の想定なので全件表示
export default async function SuppliersPage({ searchParams }: PageProps<"/admin/suppliers">) {
  await requireAccess("suppliers", "/admin/suppliers");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const includeInactive = params.all === "1";
  const suppliers = await listSuppliers(q, includeInactive);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">仕入先</h1>
        <LinkButton href="/admin/suppliers/new" variant="primary">
          ＋ 新規登録
        </LinkButton>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={q} placeholder="コード・名前・ふりがな・別名" className="w-72" />
        </Field>
        <AutoSubmitCheckbox name="all" label="取引をやめた仕入先も表示" defaultChecked={includeInactive} />
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>

      {suppliers.length === 0 ? (
        <EmptyState
          message={q ? "条件に合う仕入先はありません。" : "仕入先はまだありません。"}
          action={
            <LinkButton href="/admin/suppliers/new" variant="primary">
              ＋ 新規登録
            </LinkButton>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">コード</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2">電話</th>
                <th className="px-3 py-2">発注方法</th>
                <th className="px-3 py-2 text-right">届くまで（日）</th>
                <th className="px-3 py-2">締め/支払</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                  <td className="px-3 py-2 tabular-nums">{s.code}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/suppliers/${s.id}`} className="font-bold text-primary hover:underline">
                      {s.name}
                    </Link>
                    {!s.isActive && <span className="ml-1 text-ink-muted">（取引終了）</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{s.phone}</td>
                  <td className="px-3 py-2">{s.orderMethod ? ORDER_METHODS[s.orderMethod] : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.leadTimeDays ?? ""}</td>
                  <td className="px-3 py-2">{formatClosingAndPayment(s.closingDay, s.paymentMonthOffset, s.paymentDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
