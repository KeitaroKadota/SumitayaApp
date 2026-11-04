import { requireAccess } from "@/utils/auth";
import { formatDateTime } from "@/utils/format";
import { SHOW_PRODUCT_CODE_ALIASES } from "@/utils/masterRules";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { addProductAlias, deleteProductAlias, saveProduct, setProductActiveAction } from "../actions";
import { getProduct, listAliases, listSupplierOptions } from "../productData";
import { PRODUCT_WARNING_MESSAGES } from "../productValidation";
import { ProductForm } from "../ProductForm";
import { AliasSection } from "./AliasSection";

const SAVED_MESSAGES: Record<string, string> = {
  "1": "保存しました。",
  activated: "使用中に戻しました。",
  deactivated: "使用中止にしました。",
  alias_added: "読み替えのコードを追加しました。",
  alias_deleted: "読み替えのコードを削除しました。",
};

const ACTIVE_FORM_ID = "product-active-form";

// G05 商品の詳細・編集(CMN-02 EV-08・EV-09・EV-22・EV-23)
export default async function ProductDetailPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const { id } = await params;
  await requireAccess("products", `/admin/products/${id}`);
  const query = await searchParams;

  const product = await getProduct(id);
  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/products" label="一覧へ" />
        </div>
        <Alert tone="error">この商品は見つかりません。</Alert>
      </div>
    );
  }
  const [suppliers, aliases] = [await listSupplierOptions(product.mainSupplierId), await listAliases(product.id)];

  const saved = typeof query.saved === "string" ? SAVED_MESSAGES[query.saved] : undefined;
  const warnings =
    typeof query.warn === "string" ? query.warn.split(",").map((w) => PRODUCT_WARNING_MESSAGES[w]).filter(Boolean) : [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/products" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">
        {[product.name, product.color, product.size].filter(Boolean).join(" ")}
        {!product.isActive && <span className="ml-2 text-base text-ink-muted">（使用中止）</span>}
      </h1>

      {saved && <Alert tone="success">{saved}</Alert>}
      {query.relinked !== undefined && (
        <Alert tone="success">売上の商品の結び付けを {String(query.relinked)}件やり直しました。</Alert>
      )}
      {query.relink_failed === "1" && (
        <Alert tone="warning">
          売上の商品の結び付けはできませんでした。売上の画面の『商品の結び付けをやり直す』を押してください。
        </Alert>
      )}
      {warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}

      <ProductForm
        key={product.id}
        mode="edit"
        action={saveProduct.bind(null, product.id)}
        suppliers={suppliers}
        isActive={product.isActive}
        activeFormId={ACTIVE_FORM_ID}
        initialValues={{
          product_code: product.productCode,
          item_code: product.itemCode ?? "",
          name: product.name,
          size: product.size ?? "",
          color: product.color ?? "",
          jan_code: product.janCode ?? "",
          category_code: product.categoryCode ?? "",
          main_supplier_id: product.mainSupplierId ?? "",
          is_in_house: product.isInHouse ? "1" : "0",
          cost_price: product.costPrice?.toString() ?? "",
          sell_price: product.sellPrice?.toString() ?? "",
          sell_price_tax_included: product.sellPriceTaxIncluded ? "1" : "0",
          tax_rate: String(product.taxRate),
          order_lot: product.orderLot?.toString() ?? "",
          min_order_qty: product.minOrderQty?.toString() ?? "",
          lead_time_days: product.leadTimeDays?.toString() ?? "",
          note: product.note ?? "",
        }}
      >
        {/* 分析の結果(A-02 が書く。表示だけ。CH-14) */}
        <div className="border-t border-line pt-4 text-sm">
          <h2 className="text-lg font-bold">分析の結果（表示だけ）</h2>
          <p className="mt-2">
            ABC区分{" "}
            {product.abcRank
              ? `${product.abcRank}（${product.abcRankedAt ? `${formatDateTime(product.abcRankedAt)} 反映。` : ""}A-02）`
              : "まだありません"}
          </p>
        </div>
      </ProductForm>

      {/* 使用中止・使用中に戻す(EV-09)。ボタンはフォームの中の左に置く */}
      <form id={ACTIVE_FORM_ID} action={setProductActiveAction.bind(null, product.id)} hidden>
        <input type="hidden" name="is_active" value={product.isActive ? "0" : "1"} />
      </form>

      {SHOW_PRODUCT_CODE_ALIASES && (
        <AliasSection
          aliases={aliases}
          addAction={addProductAlias.bind(null, product.id)}
          deleteAction={deleteProductAlias.bind(null, product.id)}
        />
      )}
    </div>
  );
}
