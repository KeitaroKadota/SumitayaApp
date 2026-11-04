import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatQuantity } from "@/utils/format";
import { PRODUCT_CATEGORIES, PRODUCT_PAGE_SIZE } from "@/utils/masterRules";
import { Alert } from "@/components/Alert";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import { listProducts } from "./productData";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

// G04 商品の一覧(CMN-02 EV-07)。検索とページ送りは URL の ?q=&category=&all=&page= で持つ
export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  await requireAccess("products", "/admin/products");
  const params = await searchParams;
  const q = one(params.q).trim();
  const category = one(params.category) in PRODUCT_CATEGORIES ? one(params.category) : "";
  const includeInactive = one(params.all) === "1";
  const pageParam = Number(one(params.page));
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;

  const { total, items } = await listProducts({ q, category, includeInactive, page });

  const hrefOf = (p: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (category) search.set("category", category);
    if (includeInactive) search.set("all", "1");
    if (p > 1) search.set("page", String(p));
    const s = search.toString();
    return s ? `/admin/products?${s}` : "/admin/products";
  };

  // EV-12 手順8: 取り込みの結果(?imported=追加件数,更新件数[,結び付けた件数|failed])
  const imported = one(params.imported).split(",");
  const importedMessage =
    imported.length >= 2 && imported[0] !== ""
      ? `追加 ${formatQuantity(Number(imported[0]))}件・更新 ${formatQuantity(Number(imported[1]))}件を登録しました。` +
        (imported[2] && imported[2] !== "failed"
          ? `売上の商品の結び付けを ${formatQuantity(Number(imported[2]))}件やり直しました。`
          : "")
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">商品</h1>
        <div className="flex flex-wrap gap-2">
          {/* ひな形CSV(EV-10)はファイルを返す Route Handler なので、画面の移動(Link)ではなく普通のリンクにする */}
          <a href="/admin/products/template" download className={buttonClassName("secondary")}>
            ひな形CSVを出力する
          </a>
          <LinkButton href="/admin/products/import">CSVで取り込む</LinkButton>
          <LinkButton href="/admin/products/new" variant="primary">
            ＋ 新規登録
          </LinkButton>
        </div>
      </div>

      {importedMessage && <Alert tone="success">{importedMessage}</Alert>}
      {imported[2] === "failed" && (
        <Alert tone="warning">
          売上の商品の結び付けはできませんでした。売上の画面の『商品の結び付けをやり直す』を押してください。
        </Alert>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={q} placeholder="商品コード・品番・商品名・JAN" className="w-72" />
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
        <AutoSubmitCheckbox name="all" label="使用中止も表示" defaultChecked={includeInactive} />
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          message={q || category ? "条件に合う商品はありません。" : "商品はまだありません。"}
          action={
            <LinkButton href="/admin/products/new" variant="primary">
              ＋ 新規登録
            </LinkButton>
          }
        />
      ) : (
        <>
          <Pagination total={total} page={page} pageSize={PRODUCT_PAGE_SIZE} hrefOf={hrefOf} />
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">商品コード</th>
                  <th className="px-3 py-2">商品名</th>
                  <th className="px-3 py-2">サイズ</th>
                  <th className="px-3 py-2">色</th>
                  <th className="px-3 py-2 text-right">売価（円）</th>
                  <th className="px-3 py-2">主な仕入先</th>
                  <th className="px-3 py-2">ABC</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                    <td className="px-3 py-2 tabular-nums">
                      <Link href={`/admin/products/${p.id}`} className="font-bold text-primary hover:underline">
                        {p.productCode}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {p.name}
                      {!p.isActive && <span className="ml-1 text-ink-muted">（使用中止）</span>}
                    </td>
                    <td className="px-3 py-2">{p.size}</td>
                    <td className="px-3 py-2">{p.color}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {p.sellPrice !== null
                        ? `${formatQuantity(p.sellPrice)}${p.sellPriceTaxIncluded ? "（税込）" : "（税抜）"}`
                        : ""}
                    </td>
                    <td className="px-3 py-2">
                      {p.supplierName
                        ? `${p.supplierName}${p.supplierActive === false ? "（取引終了）" : ""}`
                        : p.isInHouse
                          ? "（自社縫製）"
                          : ""}
                    </td>
                    <td className="px-3 py-2">{p.abcRank}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={PRODUCT_PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
    </div>
  );
}
