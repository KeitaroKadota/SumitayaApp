// E-05 G02 「商品から選ぶ」の検索(03 EV-04 手順1)。商品マスタを名前・商品コードで探し、JSON で返す(読むだけ)。
// 画面(InvoiceForm)から fetch で呼ぶ。Server Function はデータの読み取り向けではないため、Route Handler にした。
// 先頭で requireAccess を呼ぶ。未ログインなどのときはログイン画面などへの移動(redirect)になる。
import { requireAccess } from "@/utils/auth";
import { searchInvoiceProducts } from "@/utils/invoicesServer";

export async function GET(request: Request) {
  await requireAccess("receivables", "/admin/invoices");
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  try {
    return Response.json({ ok: true, items: await searchInvoiceProducts(q) });
  } catch (e) {
    console.error("商品を検索できませんでした:", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "商品を検索できませんでした。時間をおいてもう一度お試しください。" }, { status: 500 });
  }
}
