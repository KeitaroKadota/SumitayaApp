import Link from "next/link";
import { Fragment } from "react";
import { requireAccess } from "@/utils/auth";
import { PRICE_KINDS, PRICE_UNITS, SHOW_PROVISIONAL_PRICE_NOTICE, isPriceKind, type PriceItem } from "@/utils/customQuote";
import { formatQuantity } from "@/utils/format";
import { UUID_PATTERN } from "@/utils/inquiries";
import { Alert } from "@/components/Alert";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { savePriceItem } from "./actions";
import { PriceItemForm } from "./PriceItemForm";
import { listPriceItems } from "./priceItemData";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const COLUMNS = 7;

const initialValuesOf = (item: PriceItem | null, kind: string): Record<string, string> =>
  item
    ? {
        kind: item.kind,
        item_type: item.itemType ?? "",
        name: item.name,
        unit: item.unit,
        unit_price: String(item.unitPrice),
        qty_from: String(item.qtyFrom),
        qty_to: item.qtyTo === null ? "" : String(item.qtyTo),
        sort_order: String(item.sortOrder),
        note: item.note ?? "",
        is_active: item.isActive ? "1" : "",
      }
    : { kind, unit: kind === "setup" ? "per_order" : "per_piece", qty_from: "1", sort_order: "0", is_active: "1" };

// D-04 G04 概算の単価表(03 EV-13)。数十〜数百行の想定なので全件表示
export default async function PriceItemsPage({ searchParams }: PageProps<"/admin/inquiries/price-items">) {
  await requireAccess("inquiry_settings", "/admin/inquiries/price-items");
  const params = await searchParams;
  const kindRaw = str(params.kind);
  const kind = isPriceKind(kindRaw) ? kindRaw : null;
  const includeInactive = params.all === "1";
  const edit = str(params.edit);
  const items = await listPriceItems({ kind, includeInactive });

  // 一覧の条件を残したURL(edit を付けると、その行が入力欄になる)
  const hrefWith = (editId: string | null) => {
    const sp = new URLSearchParams();
    if (kind) sp.set("kind", kind);
    if (includeInactive) sp.set("all", "1");
    if (editId) sp.set("edit", editId);
    const qs = sp.toString();
    return `/admin/inquiries/price-items${qs ? `?${qs}` : ""}${editId ? "#price-item-form" : ""}`;
  };
  const listHref = hrefWith(null);
  const filter = { kind: kind ?? "", all: includeInactive };
  const editItem = UUID_PATTERN.test(edit) ? (items.find((i) => i.id === edit) ?? null) : null;

  const formRow = (item: PriceItem | null) => (
    <tr id="price-item-form" className="border-b border-line bg-primary-soft">
      <td colSpan={COLUMNS}>
        <PriceItemForm
          key={item?.id ?? "new"}
          action={savePriceItem.bind(null, item?.id ?? null)}
          initialValues={initialValuesOf(item, kind ?? "")}
          filter={filter}
          cancelHref={listHref}
        />
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">概算の単価表</h1>
        <LinkButton href={hrefWith("new")} variant="primary">
          ＋ 行を足す
        </LinkButton>
      </div>
      {params.saved === "1" && <Alert tone="success">保存しました。</Alert>}
      {/* 01 の 7章: 出す・出さないは src/utils/customQuote.ts の定数で決める */}
      {SHOW_PROVISIONAL_PRICE_NOTICE && (
        <Alert tone="warning">仮の単価です。すみたや様の単価表をいただいたら、入れ替えます。</Alert>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="kind" label="区分">
          <AutoSubmitSelect id="kind" name="kind" defaultValue={kind ?? ""} className="w-40">
            <option value="">すべて</option>
            {Object.entries(PRICE_KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </Field>
        <AutoSubmitCheckbox name="all" label="使わないものも出す" defaultChecked={includeInactive} />
        <noscript>
          <button type="submit">絞り込む</button>
        </noscript>
      </form>

      {items.length === 0 && edit !== "new" ? (
        <EmptyState
          message={kind ? "この区分の行はありません。" : "単価表の行はまだありません。"}
          action={
            <LinkButton href={hrefWith("new")} variant="primary">
              ＋ 行を足す
            </LinkButton>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">区分</th>
                <th className="px-3 py-2">品目</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2">単位</th>
                <th className="px-3 py-2">枚数</th>
                <th className="px-3 py-2 text-right">単価（税抜・円）</th>
                <th className="px-3 py-2 text-center">使う</th>
              </tr>
            </thead>
            <tbody>
              {edit === "new" && formRow(null)}
              {items.map((i) =>
                editItem?.id === i.id ? (
                  <Fragment key={i.id}>{formRow(i)}</Fragment>
                ) : (
                  <tr key={i.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                    <td className="px-3 py-2 whitespace-nowrap">{PRICE_KINDS[i.kind]}</td>
                    <td className="px-3 py-2">{i.itemType ?? "−"}</td>
                    <td className="px-3 py-2">
                      {/* 行を押すと、その行が入力欄になる */}
                      <Link href={hrefWith(i.id)} className="font-bold text-primary hover:underline">
                        {i.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{PRICE_UNITS[i.unit]}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {i.kind === "setup" && i.qtyFrom === 1 && i.qtyTo === null
                        ? "−"
                        : `${formatQuantity(i.qtyFrom)}〜${i.qtyTo === null ? "" : formatQuantity(i.qtyTo)}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(i.unitPrice)}</td>
                    <td className="px-3 py-2 text-center">{i.isActive ? "○" : <span className="text-ink-muted">使わない</span>}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

