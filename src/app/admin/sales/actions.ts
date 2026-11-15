"use server";

// G01 売上の一覧の「商品の結び付けをやり直す」(A-01 EV-09)
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { countUnlinkedSalesCodes, relinkSalesProducts } from "@/utils/salesRelink";

export async function relinkSales(): Promise<void> {
  // 手順1
  await requireAccess("sales", "/admin/sales");
  // 手順2・3 結び付けた行の数と、残りのマスタに無い商品コードの数
  let query = "";
  try {
    const before = await countUnlinkedSalesCodes();
    await relinkSalesProducts();
    const after = await countUnlinkedSalesCodes();
    query = `relinked=${before - after}&before=${before}&remaining=${after}`;
  } catch (e) {
    console.error("売上の商品を結び付け直せませんでした:", e instanceof Error ? e.message : e);
    query = "relink_failed=1";
  }
  revalidatePath("/admin/sales");
  redirect(`/admin/sales?${query}`);
}
