"use server";

// G01 ABC分析の「計算する」(A-02 EV-02)。計算すると、同じトランザクションで商品マスタのランクを書き換える。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { checkAbcPeriod, runAbc } from "@/utils/abcServer";
import { formValues, type FormState } from "@/utils/formState";
import { todayJST } from "@/utils/jst";
import { formText } from "@/utils/textNormalize";

export async function runAbcAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // 手順1
  const me = await requireAccess("sales", "/admin/sales/abc");
  const values = formValues(formData);
  const from = formText(formData, "from");
  const to = formText(formData, "to");
  const today = todayJST();

  // 手順2 CH-01
  const periodError = checkAbcPeriod(from, to, today);
  if (periodError) return { errors: { period: periodError }, formError: null, values };

  // 手順3〜10
  let result: Awaited<ReturnType<typeof runAbc>>;
  try {
    result = await runAbc(from, to, today, me.id);
  } catch (e) {
    console.error("ABC分析を計算できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "売上の読み込みに失敗しました", values };
  }
  if (!result.ok) return { errors: {}, formError: result.error, values };

  revalidatePath("/admin/sales/abc");
  revalidatePath("/admin/products");
  redirect(`/admin/sales/abc/${result.runId}?calculated=${result.changed}`);
}
