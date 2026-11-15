import { requireAccess } from "@/utils/auth";
import { ITEM_CODES_URL, SLIPS_URL, isUuid, listItemCodes } from "@/utils/deliverySlipServer";
import { listActiveSuppliers } from "@/utils/masters";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import { saveSupplierItemCode } from "./actions";
import { ItemCodeForm } from "./ItemCodeForm";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");
// 列の幅(ItemCodeForm.tsx の行と同じ値)
const GRID = "grid grid-cols-[8rem_minmax(8rem,1fr)_minmax(10rem,1fr)_5rem_4rem_6rem] items-start gap-2";

// G04 仕入先の品番の対応表(C-01 03 EV-12)。機能キー purchasing。仕入先は URL の ?supplier=&q= で持つ。
// まとめて取り込む仕組みは作らない(1件ずつ。C-01 01 0.3)
export default async function ItemCodesPage({
  searchParams,
}: {
  // (props の型は PageProps<"/admin/purchasing/item-codes"> と同じ形。型の生成〔next typegen〕の前でも通るように書いた)
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 手順1
  await requireAccess("purchasing", ITEM_CODES_URL);
  const params = await searchParams;
  const suppliers = await listActiveSuppliers();
  const supplierParam = str(params.supplier);
  const supplier = isUuid(supplierParam) ? suppliers.find((s) => s.id === supplierParam) : undefined;
  const q = str(params.q).slice(0, 50);
  // 手順2: 仕入先を選ぶと、その仕入先の対応を品番の順に出す
  const rows = supplier ? await listItemCodes(supplier.id, q) : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href={SLIPS_URL} label="納品書の一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">仕入先の品番の対応表</h1>
      <p className="text-sm text-ink-muted">
        「入数」は、伝票の1単位が自社の何個にあたるか（1箱＝10枚なら10）です。納品書の確定のときに選んだ商品は、ここに自動で足されます。
      </p>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="supplier" label="仕入先">
          <Select id="supplier" name="supplier" defaultValue={supplier?.id ?? ""} className="w-64">
            <option value="">（選んでください）</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={q} placeholder="品番・品名" className="w-56" />
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          表示
        </button>
      </form>

      {!supplier ? (
        <EmptyState message="仕入先を選んでください。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface p-3">
          <div className="min-w-[48rem]">
            <div className={`${GRID} border-b border-line pb-2 text-sm font-bold`}>
              <span>仕入先の品番</span>
              <span>仕入先の品名</span>
              <span>自社の商品</span>
              <span className="text-right">入数</span>
              <span>使用</span>
              <span />
            </div>
            {rows.length === 0 && <p className="py-3 text-sm text-ink-muted">対応はまだありません。</p>}
            {rows.map((r) => (
              <ItemCodeForm
                key={`${r.id}-${r.supplierItemCode}-${r.productCode}-${r.packQuantity}-${r.isActive}`}
                action={saveSupplierItemCode}
                supplierId={supplier.id}
                initial={{
                  id: r.id,
                  code: r.supplierItemCode,
                  name: r.supplierItemName ?? "",
                  productCode: r.productCode,
                  productName: r.productName,
                  pack: r.packQuantity,
                  active: r.isActive,
                }}
              />
            ))}
            <p className="pt-3 text-sm font-bold">＋対応を足す</p>
            <ItemCodeForm action={saveSupplierItemCode} supplierId={supplier.id} initial={null} />
          </div>
        </div>
      )}
    </div>
  );
}
