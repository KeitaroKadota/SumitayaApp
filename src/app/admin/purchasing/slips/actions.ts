"use server";

// 納品書の確認・修正(C-01 G03)の操作(03 EV-06・EV-08〜EV-11、04 CH-05〜CH-12)。機能キー purchasing(社長・店舗・経理)。
// 入力のエラーは FormState で画面に返す。保存のあとの確定の確認(計算が合わない・同じ伝票番号)は、
// 保存で画面の版が変わるので ?prompt= を付けて G03 に戻し、G03 の「このまま確定」(confirmDeliverySlip)で続ける。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess, type CurrentEmployee } from "@/utils/auth";
import { checkSlip, confirmBlockers, isLineEdited, parseSlipForm, type SlipLineInput } from "@/utils/deliverySlipRules";
import {
  ITEM_CODES_URL,
  SLIPS_URL,
  cancelSlip,
  findConfirmedDuplicates,
  getSlip,
  isActiveSupplier,
  isCurrentVersion,
  learnItemCodes,
  markConfirmed,
  readSlipWithAi,
  saveSlip,
  slipUrl,
  unconfirmSlip,
} from "@/utils/deliverySlipServer";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { todayJST } from "@/utils/jst";
import { findProductsByCodes } from "@/utils/masters";
import { receivingUrl } from "@/utils/receiving";
import { clearSlipMatch, matchConfirmedSlip } from "@/utils/receivingLinks";
import { formText } from "@/utils/textNormalize";

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CONFLICT = "ほかの人がこの納品書を更新しました。画面を開き直してください。";

const refresh = (id: string) => {
  revalidatePath(SLIPS_URL);
  revalidatePath(slipUrl(id));
  revalidatePath(ITEM_CODES_URL);
};

// ---- EV-10 手順3〜8: 確定する(保存のあと・「このまま確定」から) ----

const finishConfirm = async (
  slipId: string,
  me: CurrentEmployee,
  { acceptArithmetic, forceDuplicate }: { acceptArithmetic: boolean; forceDuplicate: boolean }
): Promise<never> => {
  const loaded = await getSlip(slipId);
  if (!loaded) redirect(`${SLIPS_URL}?error=not_found`);
  const { slip, lines } = loaded;
  if (slip.status !== "draft" || slip.readStatus === "reading") redirect(`${slipUrl(slipId)}?error=status`);

  // 手順3: CH-10 確定に必要な項目
  if (confirmBlockers(slip, lines).length > 0) redirect(`${slipUrl(slipId)}?done=saved&error=confirm`);
  // 手順4: 計算の見直し(CH-07・CH-08)で合わないものが残っていれば、確認を出す
  const checked = checkSlip({ header: slip, lines, slipConfidence: slip.confidence, hasAiResult: slip.aiResult !== null, today: todayJST() });
  if (checked.hasArithmeticIssue && !acceptArithmetic) redirect(`${slipUrl(slipId)}?done=saved&prompt=arithmetic`);
  // 手順3: CH-11 同じ伝票の二重登録(「このまま確定」も選べる。計算の確認を済ませていれば、それも引き継ぐ)
  if (!forceDuplicate && (await findConfirmedDuplicates(slipId, slip)).length > 0)
    redirect(`${slipUrl(slipId)}?done=saved&prompt=duplicate${acceptArithmetic ? "&accepted=arithmetic" : ""}`);

  // 手順5: 確定(needs_check はそのまま残し、C-02 で使う)
  let ok = false;
  try {
    ok = await markConfirmed(slipId, me.id);
  } catch (e) {
    console.error("納品書を確定できませんでした:", e instanceof Error ? e.message : e);
    redirect(`${slipUrl(slipId)}?error=save`);
  }
  if (!ok) redirect(`${slipUrl(slipId)}?error=status`);

  // 手順6: 人が選んだ商品の品番を対応表に足す(足せなくても確定は取り消さない)
  let learned = 0;
  try {
    learned = await learnItemCodes(slipId, me.id);
  } catch (e) {
    console.error("品番の対応表に足せませんでした:", e instanceof Error ? e.message : e);
  }
  // 手順7: C-02 の照合(一致すれば自動で検収する。照合に失敗しても確定は残し、C-02 の画面で照合し直す)
  try {
    await matchConfirmedSlip(slipId, me.id);
  } catch (e) {
    console.error("納品書を照合できませんでした:", e instanceof Error ? e.message : e);
  }
  // 手順8: C-02 の照合の結果の画面(C-02 G02)へ移す
  refresh(slipId);
  redirect(`${receivingUrl(slipId)}?done=confirmed${learned > 0 ? `&learned=${learned}` : ""}`);
};

// ---- EV-08 「保存」・EV-10 「確定する」(intent = save・confirm) ----

export async function saveDeliverySlip(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("purchasing", slipUrl(id));
  const values = formValues(formData);
  const loaded = await getSlip(id);
  if (!loaded) return { errors: {}, formError: "この納品書は見つかりません。", values };
  const { slip, lines: currentLines } = loaded;
  // 手順1: CH-05 確かめ中で、読み取り中でない
  if (slip.status !== "draft" || slip.readStatus === "reading")
    return { errors: {}, formError: "この納品書は、今の状態では直せません。画面を開き直してください。", values };

  // 手順2: CH-06 入力の形(だめな値はエラーにして保存しない。空は許す)
  const parsed = parseSlipForm(values);
  if (!parsed.ok) return { errors: parsed.errors, formError: errorSummary(parsed.errors), values };
  const { header } = parsed;
  const errors: Record<string, string> = {};
  if (header.supplierId && header.supplierId !== slip.supplierId && !(await isActiveSupplier(header.supplierId)))
    errors.supplier_id = "仕入先を選び直してください。";
  // 自社の商品コード → 商品ID(在庫にしない品は選ばなくてよい)
  const products = await findProductsByCodes(parsed.lines.map((l) => l.productCode).filter((c): c is string => Boolean(c)));
  const lines: SlipLineInput[] = parsed.lines.map((l, i) => {
    const product = l.productCode ? products.get(l.productCode) : undefined;
    if (l.productCode && !product) errors[`l${i}_product`] = `明細${i + 1}: 商品コード「${l.productCode}」は商品マスタにありません。`;
    const before = currentLines.find((c) => c.id === l.originalId) ?? null;
    const line: SlipLineInput = {
      ...l,
      productId: product?.id ?? null,
      // 信頼度は読み取ったときの値のまま(画面の値は使わない)
      confidence: before?.confidence ?? null,
      isEdited: false,
    };
    // 手順3: AIの値と違う明細は is_edited(一度直した明細は直したまま)
    line.isEdited = (before?.isEdited ?? false) || isLineEdited(before, line);
    return line;
  });
  if (Object.keys(errors).length > 0) return { errors, formError: errorSummary(errors), values };

  // 手順3・4: 伝票と明細を上書きし、見直し(EV-09)をもう一度行う
  let saved: Awaited<ReturnType<typeof saveSlip>>;
  try {
    saved = await saveSlip(id, formText(formData, "version"), header, lines, slip.confidence, slip.aiResult !== null, me.id);
  } catch (e) {
    console.error("納品書を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  if (!saved.ok) return { errors: {}, formError: CONFLICT, values };
  refresh(id);

  // 手順5
  if (formData.get("intent") !== "confirm") redirect(`${slipUrl(id)}?done=saved`);
  // EV-10(計算が合わないときの確認は、画面で「このまま確定」を選んだときに accept_arithmetic が付く)
  return finishConfirm(id, me, {
    acceptArithmetic: formText(formData, "accept_arithmetic") === "1",
    forceDuplicate: false,
  });
}

// ---- EV-10 「このまま確定」(計算が合わない・同じ伝票番号の確認のあと) ----

export async function confirmDeliverySlip(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("purchasing", slipUrl(id));
  if (!(await isCurrentVersion(id, formText(formData, "version")))) redirect(`${slipUrl(id)}?error=conflict`);
  await finishConfirm(id, me, {
    acceptArithmetic: formText(formData, "accept_arithmetic") === "1",
    forceDuplicate: formText(formData, "force_duplicate") === "1",
  });
}

// ---- EV-06 「もう一度AIで読み取る」 ----

export async function rereadDeliverySlip(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("purchasing", slipUrl(id));
  const loaded = await getSlip(id);
  if (!loaded) redirect(`${SLIPS_URL}?error=not_found`);
  // 止まった読み取り(読み取り中のまま2分)からも読み取り直せるよう、読み取り中のときは版を見ない
  if (loaded.slip.readStatus !== "reading" && !(await isCurrentVersion(id, formText(formData, "version"))))
    redirect(`${slipUrl(id)}?error=conflict`);
  let outcome = "failed";
  try {
    outcome = await readSlipWithAi(id, me.id);
  } catch (e) {
    console.error("納品書を読み取れませんでした:", e instanceof Error ? e.message : e);
  }
  refresh(id);
  // CH-05 で読み取りできない状態だったとき
  if (outcome === "busy") redirect(`${slipUrl(id)}?error=busy`);
  redirect(`${slipUrl(id)}?read=${outcome}`);
}

// ---- EV-11 「取消」「確定を取り消す」(CH-12) ----

export async function cancelDeliverySlip(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("purchasing", slipUrl(id));
  let ok = false;
  try {
    ok = await cancelSlip(id, formText(formData, "version"), me.id);
  } catch (e) {
    console.error("納品書を取り消せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${slipUrl(id)}?error=save`);
  }
  if (!ok) redirect(`${slipUrl(id)}?error=cancel`);
  refresh(id);
  redirect(`${slipUrl(id)}?done=cancelled`);
}

export async function unconfirmDeliverySlip(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("purchasing", slipUrl(id));
  let ok = false;
  try {
    ok = await unconfirmSlip(id, formText(formData, "version"), me.id);
    // C-02 が持つもの(確認のタスク)を片付ける
    if (ok) await clearSlipMatch(id, me.id);
  } catch (e) {
    console.error("確定を取り消せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${slipUrl(id)}?error=save`);
  }
  if (!ok) redirect(`${slipUrl(id)}?error=unconfirm`);
  refresh(id);
  redirect(`${slipUrl(id)}?done=unconfirmed`);
}
