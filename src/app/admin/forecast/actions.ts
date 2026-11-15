"use server";

// G01 予測と発注の提案の操作(A-03 EV-02「予測を計算する」・EV-03「選んだ商品で発注の下書きを作る」)
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { createDraftsFromSuggestions, runForecast } from "@/utils/forecastServer";
import { todayJST } from "@/utils/jst";

export type ForecastActionState = { error: string | null; notes: string[] };

// EV-02
export async function runForecastAction(_prev: ForecastActionState, _formData: FormData): Promise<ForecastActionState> {
  void _formData;
  // 手順1
  const me = await requireAccess("sales", "/admin/forecast");
  // 手順2〜8
  const result = await runForecast(todayJST(), me.id);
  if (!result.ok) return { error: result.error, notes: [] };
  // 手順9 G01 を開き直す
  revalidatePath("/admin/forecast");
  redirect(
    `/admin/forecast?calculated=${result.products}&need=${result.needOrder}&production=${result.production}&failed=${result.failed}`
  );
}

// EV-03
export async function createDraftsAction(_prev: ForecastActionState, formData: FormData): Promise<ForecastActionState> {
  // 手順1
  const me = await requireAccess("sales", "/admin/forecast");
  const ids = formData.getAll("sid").filter((v): v is string => typeof v === "string");
  // 手順2〜7
  let result: Awaited<ReturnType<typeof createDraftsFromSuggestions>>;
  try {
    result = await createDraftsFromSuggestions(ids, me.id);
  } catch (e) {
    console.error("発注の下書きを作れませんでした:", e instanceof Error ? e.message : e);
    return { error: "発注の下書きを作れませんでした。何も保存していません。もう一度お試しください。", notes: [] };
  }
  if (!result.ok) return { error: result.error, notes: result.skipped };
  revalidatePath("/admin/forecast");
  revalidatePath("/admin/purchase-orders");
  // 手順8 下書きが1つなら G06、複数なら G05(下書きで絞った一覧)
  if (result.purchaseOrderIds.length === 1) redirect(`/admin/purchase-orders/${result.purchaseOrderIds[0]}?created=1`);
  redirect(`/admin/purchase-orders?status=draft&created=${result.purchaseOrderIds.length}`);
}
