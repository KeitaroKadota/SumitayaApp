// G04 「ひな形CSVを出力する」(CMN-02 EV-10)。見出しと記入例1行の CSV(UTF-8・BOM付き・CRLF)を返す。
import { requireAccess } from "@/utils/auth";
import { csvResponse } from "@/utils/csv";
import { productTemplateRows } from "@/utils/productCsv";

export async function GET() {
  await requireAccess("products", "/admin/products");
  return csvResponse("商品ひな形.csv", productTemplateRows());
}
