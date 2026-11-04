// D-02 のパネル(G01)と、在庫の案に付ける根拠・注意。D-01 の詳細画面(page.tsx)から使うサーバーの部品。
// 呼ぶ側のページで requireAccess("inquiries", …) を済ませておくこと。
import { Alert } from "@/components/Alert";
import { formatDateShort, formatDateTime } from "@/utils/format";
import { STOCK_LIMITS } from "@/utils/inquirySettings";
import { purposeLabel } from "@/utils/replyTemplateRules";
import { listStockTemplates } from "@/utils/replyTemplates";
import { STOCK_JUDGEMENTS, parseFactsItems, type StockAnswer } from "@/utils/stockAnswer";
import {
  getStockProductOptions,
  lastStockSelection,
  loadStockAnswer,
  searchStockProducts,
  type StockProductOption,
  type StockSelection,
} from "@/utils/stockAnswerData";
import type { InquiryDetail, InquiryReply } from "../inquiryData";
import { createStockReply } from "../stockReplyActions";
import { StockInquiryPanel, type StockSelected } from "./StockInquiryPanel";

// パネルの操作のエラー(?stock_error=)
const STOCK_ERRORS: Record<string, string> = {
  none: "商品を1つ以上選んでください。",
  too_many: `商品は${STOCK_LIMITS.selectedMax}件までにしてください。`,
  quantity: `数は1〜${STOCK_LIMITS.quantityMax}の整数で入力してください。`,
  template: "ひな形を選び直してください。",
  no_template: "ひな形がありません。「返信のひな形」の画面で、在庫のひな形を作ってください。",
  load: "在庫を読めませんでした。時間をおいてもう一度お試しください。",
};
// AIで作れずにひな形で作ったときの文(?stock_ai=。EV-04 手順4)
const STOCK_AI_FALLBACK: Record<string, string> = {
  no_key: "AIの設定（APIキー）がありません。",
  limit: "本日のAIの利用回数に達しました。",
  bad_key: "AIのAPIキーが正しくありません。（管理者の方: 環境変数 GEMINI_API_KEY を確かめてください）",
  bad_model: "AIのモデル名が見つかりません。（管理者の方: 環境変数 GEMINI_MODEL を確かめてください）",
  failed: "",
};

export const stockErrorMessage = (code: string): string | undefined => STOCK_ERRORS[code];
export const stockFallbackMessage = (code: string): string | undefined =>
  code in STOCK_AI_FALLBACK ? `AIで作れませんでした。ひな形で案を作ります。${STOCK_AI_FALLBACK[code]}` : undefined;

// 抜き出した商品の検索の言葉(コードがあればコード、無ければ名前・サイズ・色)
const searchTextOf = (p: { name: string | null; code: string | null; size: string | null; color: string | null }): string =>
  (p.code?.trim() || [p.name, p.size, p.color].filter(Boolean).join(" ")).trim();

const clampQuantity = (n: number | null | undefined): number =>
  n && Number.isInteger(n) && n >= 1 ? Math.min(n, STOCK_LIMITS.quantityMax) : 1;

// G01 EV-01 パネルを開く
export async function StockPanelSection({ inquiry, aiStopped }: { inquiry: InquiryDetail; aiStopped: boolean }) {
  const extracted = (inquiry.aiExtracted?.products ?? []).slice(0, STOCK_LIMITS.selectedMax);
  const foundText = extracted
    .map((p) => [p.name, p.code, p.size, p.color].filter(Boolean).join(" ") + (p.quantity ? ` ${p.quantity}点` : ""))
    .filter((t) => t.trim())
    .join("／");

  let candidates: StockProductOption[] = [];
  let selected: StockSelected[] = [];
  let answer: StockAnswer;
  let templates: { id: string; label: string }[];
  const terms = extracted.map((p) => ({ text: searchTextOf(p), quantity: clampQuantity(p.quantity) }));
  try {
    // 手順1・2: 抜き出した商品ごとに探し、候補が1件だけなら選んだ状態にする
    let selection: StockSelection[] = [];
    for (const t of terms) {
      if (t.text.length < STOCK_LIMITS.searchMin || t.text.length > STOCK_LIMITS.searchMax) continue;
      const found = await searchStockProducts(t.text);
      for (const f of found) if (!candidates.some((c) => c.id === f.id)) candidates.push(f);
      if (found.length === 1 && !selection.some((s) => s.productId === found[0].id))
        selection.push({ productId: found[0].id, quantity: t.quantity });
    }
    candidates = candidates.slice(0, STOCK_LIMITS.searchResults);
    // 手順3: 過去に作った在庫の案があれば、その選んだ商品を読み込む
    const last = await lastStockSelection(inquiry.id);
    if (last.length > 0) selection = last.slice(0, STOCK_LIMITS.selectedMax);

    const options = await getStockProductOptions(selection.map((s) => s.productId));
    selected = selection.flatMap((s) => {
      const product = options.find((o) => o.id === s.productId);
      return product ? [{ product, quantity: String(s.quantity) }] : [];
    });
    answer = await loadStockAnswer(selection.filter((s) => options.some((o) => o.id === s.productId)));
    templates = (await listStockTemplates()).map((t) => ({ id: t.id, label: `${purposeLabel("stock", t.purpose)}: ${t.name}` }));
  } catch (e) {
    console.error("在庫照会のパネルを読めませんでした:", e instanceof Error ? e.message : e);
    return <Alert tone="error">在庫を読めませんでした。時間をおいてもう一度お試しください。</Alert>;
  }

  return (
    <StockInquiryPanel
      action={createStockReply.bind(null, inquiry.id)}
      foundText={foundText}
      initialQuery={terms.find((t) => t.text)?.text ?? ""}
      initialCandidates={candidates}
      initialSelected={selected}
      initialAnswer={answer}
      templates={templates}
      aiStopped={aiStopped}
    />
  );
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

// 在庫の案の上に出す根拠・注意(EV-04 手順8)。在庫の時点・商品ごとの判定と日付・警告(CH-04・CH-05・CH-07・CH-08)
export function StockDraftNotes({ reply }: { reply: InquiryReply }) {
  const facts = reply.facts ?? {};
  const items = parseFactsItems(facts.items);
  const warnings = stringList(facts.warnings);
  const stockAsOf = typeof facts.stock_as_of === "string" ? facts.stock_as_of : null;
  const subject = typeof facts.subject === "string" ? facts.subject : null;
  return (
    <div className="mb-2 flex flex-col gap-2 text-sm">
      {warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((i) => (
            <li key={i.product_id}>
              {i.name}（{i.quantity_wanted}点）: {STOCK_JUDGEMENTS[i.judgement].mark} {STOCK_JUDGEMENTS[i.judgement].label}
              {i.ship_date && ` / 出荷できる日 ${formatDateShort(i.ship_date)}`}
              {i.incoming_date && ` / 入荷予定 ${formatDateShort(i.incoming_date)}`}
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-muted">在庫の時点: {stockAsOf ? formatDateTime(stockAsOf) : "在庫の記録なし"}</p>
      {subject && <p>件名の案: {subject}</p>}
    </div>
  );
}
