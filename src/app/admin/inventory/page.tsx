import { redirect } from "next/navigation";
import { canAccess, requireLogin } from "@/utils/auth";
import { formatDateTime, formatQuantity } from "@/utils/format";
import {
  INVENTORY_PAGE_SIZE,
  STOCK_STALE_HOURS,
  getLatestStockSyncedAt,
  isStockStale,
  listInventory,
  stockAgeDays,
} from "@/utils/inventoryLevels";
import { PRODUCT_CATEGORIES } from "@/utils/masterRules";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

// 前回との差(+3・−3。前回が無ければ空)
const diffText = (quantity: number, previous: number | null): string => {
  if (previous === null) return "";
  const d = quantity - previous;
  return d > 0 ? `+${formatQuantity(d)}` : formatQuantity(d);
};

// G05 在庫の一覧(B-01 EV-07)。検索とページ送りは URL の ?q=&category=&zero=&page= で持つ
export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  // 手順1: orders か inventory のどちらかを使える人(工場の人も見られる。01 3章)
  const me = await requireLogin("/admin/inventory");
  if (!canAccess(me.roles, "orders") && !canAccess(me.roles, "inventory")) redirect("/no-permission");
  // 手順4: 取り込みボタンは orders を使える人にだけ出す
  const canImport = canAccess(me.roles, "orders");

  const params = await searchParams;
  const q = str(params.q).slice(0, 100);
  const category = str(params.category) in PRODUCT_CATEGORIES ? str(params.category) : "";
  const zeroOnly = str(params.zero) === "1";
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  // 手順2・3
  const { total, items } = await listInventory({ q, category, zeroOnly }, page);
  const syncedAt = await getLatestStockSyncedAt();
  const stale = syncedAt ? isStockStale(syncedAt) : false;
  const staleDays = syncedAt ? stockAgeDays(syncedAt) : 0;

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    if (zeroOnly) sp.set("zero", "1");
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/admin/inventory?${s}` : "/admin/inventory";
  };

  // EV-06 手順6: 取り込みの結果(?imported=品数[,kpi_failed])
  const imported = str(params.imported).split(",");
  const importedMessage = imported[0] ? `${formatQuantity(Number(imported[0]))}品の在庫を更新しました。` : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">在庫</h1>
        {canImport && (
          <LinkButton href="/admin/inventory/import" variant="primary">
            在庫CSVを取り込む
          </LinkButton>
        )}
      </div>

      {importedMessage && (
        <Alert tone="success">
          {importedMessage}
          {imported[1] === "kpi_failed" && "在庫の指標を記録できませんでした（A-05 の画面で記録し直せます）。"}
        </Alert>
      )}

      {/* CH-12 在庫の時点。24時間より古ければ注意 */}
      {syncedAt === null ? (
        <p className="text-sm text-ink-muted">CROSS MALL の在庫はまだ取り込んでいません。</p>
      ) : stale ? (
        <Alert tone="warning">
          CROSS MALL の在庫: {formatDateTime(syncedAt)} 時点。
          {staleDays >= 1 ? `${formatQuantity(staleDays)}日前の在庫です。` : `${STOCK_STALE_HOURS}時間より前の在庫です。`}
          在庫CSVを取り込んでください。
        </Alert>
      ) : (
        <p className="text-sm">CROSS MALL の在庫: {formatDateTime(syncedAt)} 時点</p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={q} placeholder="商品コード・商品名・JAN" className="w-72" />
        </Field>
        <Field id="category" label="分類">
          <Select id="category" name="category" defaultValue={category} className="w-44">
            <option value="">すべて</option>
            {Object.entries(PRODUCT_CATEGORIES).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox name="zero" value="1" label="在庫0のみ" defaultChecked={zeroOnly} />
        <button type="submit" className={buttonClassName("secondary")}>
          検索
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          message={q || category || zeroOnly ? "条件に合う在庫はありません。" : "在庫はまだありません。"}
          action={
            canImport ? (
              <LinkButton href="/admin/inventory/import" variant="primary">
                在庫CSVを取り込む
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <Pagination total={total} page={page} pageSize={INVENTORY_PAGE_SIZE} hrefOf={hrefOf} />
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">商品コード</th>
                  <th className="px-3 py-2">商品名</th>
                  <th className="px-3 py-2 text-right">在庫数</th>
                  <th className="px-3 py-2 text-right">引当済み</th>
                  <th className="px-3 py-2 text-right">販売可能</th>
                  <th className="px-3 py-2 text-right">前回との差</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.productId} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 tabular-nums">{i.productCode}</td>
                    <td className="px-3 py-2">{i.name}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${i.quantity <= 0 ? "font-bold text-danger" : ""}`}>
                      {formatQuantity(i.quantity)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {i.allocatedQuantity !== null ? formatQuantity(i.allocatedQuantity) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {i.availableQuantity !== null ? formatQuantity(i.availableQuantity) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{diffText(i.quantity, i.previousQuantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={INVENTORY_PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
    </div>
  );
}
