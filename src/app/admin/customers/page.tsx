import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { CUSTOMER_TYPES, formatClosingAndPayment } from "@/utils/masterRules";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { TextInput } from "@/components/TextInput";
import { listCustomers } from "./customerData";

// G09 取引先の一覧(CMN-02 EV-14)。数十件の想定なので全件表示
export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requireAccess("customers", "/admin/customers");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const includeInactive = params.all === "1";
  const customers = await listCustomers(q, includeInactive);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">取引先</h1>
        <LinkButton href="/admin/customers/new" variant="primary">
          ＋ 新規登録
        </LinkButton>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={q} placeholder="コード・名前・ふりがな" className="w-72" />
        </Field>
        <AutoSubmitCheckbox name="all" label="取引をやめた取引先も表示" defaultChecked={includeInactive} />
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>

      {customers.length === 0 ? (
        <EmptyState
          message={q ? "条件に合う取引先はありません。" : "取引先はまだありません。"}
          action={
            <LinkButton href="/admin/customers/new" variant="primary">
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
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2">担当者</th>
                <th className="px-3 py-2">電話</th>
                <th className="px-3 py-2">締め/支払期限</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                  <td className="px-3 py-2 tabular-nums">{c.code}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/customers/${c.id}`} className="font-bold text-primary hover:underline">
                      {c.name} {c.honorific}
                    </Link>
                    {!c.isActive && <span className="ml-1 text-ink-muted">（取引終了）</span>}
                  </td>
                  <td className="px-3 py-2">{CUSTOMER_TYPES[c.customerType]}</td>
                  <td className="px-3 py-2">{c.contactName}</td>
                  <td className="px-3 py-2 tabular-nums">{c.phone}</td>
                  <td className="px-3 py-2">{formatClosingAndPayment(c.closingDay, c.paymentMonthOffset, c.paymentDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
