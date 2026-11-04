"use client";

// D-02 G01 在庫照会のパネル(03 EV-01〜EV-05)。D-01 の詳細画面(G04)の中に、種類が在庫のときに出す。
// 商品を選ぶ・数を変える・外すたびに、サーバーで表を作り直す(保存はしない)。
// 「案を作る」では、選んだ商品のIDと数だけを送り、サーバーで在庫を読み直して計算する。
import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/Alert";
import { Button, buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import { formatDateShort, formatDateTime } from "@/utils/format";
import { STOCK_LIMITS } from "@/utils/inquirySettings";
import { STOCK_JUDGEMENTS, parseWantedQuantity, type StockAnswer } from "@/utils/stockAnswer";
import type { StockProductOption } from "@/utils/stockAnswerData";
import { calcStockForPanel, searchStockForPanel } from "../stockReplyActions";

export type StockSelected = { product: StockProductOption; quantity: string };

// 押したボタンの mode(ai・template)をフォームの値に入れて送る
function ModeButton({
  mode,
  variant,
  disabled,
  children,
}: {
  mode: "ai" | "template";
  variant: "primary" | "secondary";
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("mode") === mode;
  return (
    <button type="submit" name="mode" value={mode} disabled={pending || disabled} className={buttonClassName(variant)}>
      {mine ? "作成中…" : children}
    </button>
  );
}

const JUDGEMENT_TONES: Record<keyof typeof STOCK_JUDGEMENTS, string> = {
  available: "text-success",
  incoming: "text-ink",
  estimate: "text-warning",
  check: "text-warning",
  discontinued: "text-danger",
};

export function StockInquiryPanel({
  action,
  foundText,
  initialQuery,
  initialCandidates,
  initialSelected,
  initialAnswer,
  templates,
  aiStopped,
}: {
  action: (formData: FormData) => Promise<void>;
  // AIが見つけた商品(表示用の文)
  foundText: string;
  initialQuery: string;
  initialCandidates: StockProductOption[];
  initialSelected: StockSelected[];
  initialAnswer: StockAnswer;
  templates: { id: string; label: string }[];
  aiStopped: boolean;
}) {
  const [q, setQ] = useState(initialQuery);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [picked, setPicked] = useState<string>(initialCandidates[0]?.id ?? "");
  const [selected, setSelected] = useState(initialSelected);
  const [answer, setAnswer] = useState(initialAnswer);
  const [message, setMessage] = useState<string | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // EV-02 「探す」
  const search = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await searchStockForPanel(q);
        if (r.ok) {
          setCandidates(r.items);
          setPicked(r.items[0]?.id ?? "");
        } else {
          setCandidates([]);
          setMessage(r.message);
        }
      } catch {
        setMessage("探せませんでした。時間をおいてもう一度お試しください。");
      }
    });

  // EV-03 手順2: 表を作り直す(CH-02 数がおかしいときは作り直さない)
  const recalc = (next: StockSelected[]) => {
    if (next.some((s) => parseWantedQuantity(s.quantity) === null)) {
      setCalcError(`数は1〜${STOCK_LIMITS.quantityMax}の整数で入力してください。`);
      return;
    }
    startTransition(async () => {
      setCalcError(null);
      try {
        const r = await calcStockForPanel(next.map((s) => ({ productId: s.product.id, quantity: s.quantity })));
        if (r.ok) setAnswer(r.answer);
        else setCalcError(r.message);
      } catch {
        setCalcError("在庫を読めませんでした。時間をおいてもう一度お試しください。");
      }
    });
  };

  const add = () => {
    const product = candidates.find((c) => c.id === picked);
    if (!product || selected.some((s) => s.product.id === product.id)) return;
    if (selected.length >= STOCK_LIMITS.selectedMax) {
      setCalcError(`商品は${STOCK_LIMITS.selectedMax}件までにしてください。`);
      return;
    }
    const next = [...selected, { product, quantity: "1" }];
    setSelected(next);
    recalc(next);
  };
  const remove = (id: string) => {
    const next = selected.filter((s) => s.product.id !== id);
    setSelected(next);
    recalc(next);
  };
  const changeQuantity = (id: string, quantity: string) =>
    setSelected((prev) => prev.map((s) => (s.product.id === id ? { ...s, quantity } : s)));

  const rowOf = (id: string) => answer.rows.find((r) => r.productId === id);
  const stockAsOf = answer.stockAsOf ? new Date(answer.stockAsOf) : null;
  const hoursAgo = answer.stockAgeHours ?? 0;
  const canCreate = selected.length > 0 && selected.length <= STOCK_LIMITS.selectedMax && !calcError;

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="text-ink-muted">AIが見つけた商品: </span>
        {foundText || <span className="text-ink-muted">なし</span>}
      </p>

      {/* EV-02 商品を探す(この欄はフォームの値に入れない) */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="stock_search" label="商品を探す" description="商品コード・JANコード、または商品名・サイズ・色（空白で区切る）">
            <TextInput
              id="stock_search"
              value={q}
              maxLength={STOCK_LIMITS.searchMax}
              onChange={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Enter で案を作らないように、探すだけにする
                if (e.key === "Enter") {
                  e.preventDefault();
                  search();
                }
              }}
              className="w-64"
            />
          </Field>
          <Button variant="secondary" disabled={busy} onClick={search}>
            {busy ? "読んでいます…" : "探す"}
          </Button>
        </div>
        {message && <p className="text-sm text-ink-muted">{message}</p>}
        {candidates.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold">候補（コード順。最大{STOCK_LIMITS.searchResults}件）</p>
            <ul className="flex flex-col">
              {candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="stock_candidate"
                      value={c.id}
                      checked={picked === c.id}
                      onChange={() => setPicked(c.id)}
                      className="size-5 shrink-0 accent-primary"
                    />
                    <span className="w-28 shrink-0 break-all text-ink-muted">{c.productCode}</span>
                    <span className="min-w-0 flex-1 break-words">{c.displayName}</span>
                    {!c.isActive && <span className="shrink-0 text-danger">取り扱い終了</span>}
                  </label>
                </li>
              ))}
            </ul>
            <div>
              <Button variant="secondary" disabled={busy || !picked} onClick={add}>
                商品を足す
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 選んだ商品と判定 */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold">選んだ商品</p>
        {calcError && <Alert tone="error">{calcError}</Alert>}
        {selected.length === 0 ? (
          <p className="text-sm text-ink-muted">商品を探して「商品を足す」を押してください。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-2 py-2">商品</th>
                  <th className="px-2 py-2">数</th>
                  <th className="px-2 py-2 text-right">在庫</th>
                  <th className="px-2 py-2">判定</th>
                  <th className="px-2 py-2">出荷できる日</th>
                  <th className="px-2 py-2">入荷予定</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {selected.map((s) => {
                  const r = rowOf(s.product.id);
                  return (
                    <tr key={s.product.id} className="border-b border-line last:border-b-0">
                      <td className="px-2 py-2">
                        <span className="text-ink-muted">{s.product.productCode}</span> {s.product.displayName}
                        <input type="hidden" name="product_id" value={s.product.id} />
                      </td>
                      <td className="px-2 py-2">
                        <TextInput
                          name="quantity"
                          inputMode="numeric"
                          aria-label={`${s.product.displayName}の数`}
                          value={s.quantity}
                          onChange={(e) => changeQuantity(s.product.id, e.currentTarget.value)}
                          onBlur={() => recalc(selected)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              recalc(selected);
                            }
                          }}
                          className="w-16 text-right"
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{r?.usableQuantity ?? "−"}</td>
                      <td className={`px-2 py-2 whitespace-nowrap ${r ? JUDGEMENT_TONES[r.judgement] : ""}`}>
                        {r ? `${STOCK_JUDGEMENTS[r.judgement].mark} ${STOCK_JUDGEMENTS[r.judgement].label}` : "−"}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums">{r?.shipDate ? formatDateShort(r.shipDate) : "−"}</td>
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                        {r?.incomingDate ? formatDateShort(r.incomingDate) : "−"}
                      </td>
                      <td className="px-2 py-2">
                        <Button variant="secondary" disabled={busy} onClick={() => remove(s.product.id)}>
                          外す
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {busy && <p className="text-sm text-ink-muted">在庫を読んでいます…</p>}
      </div>

      {/* CH-04 在庫の時点。古ければ黄色の ⚠ */}
      {stockAsOf &&
        (answer.stockStale ? (
          <Alert tone="warning">
            ⚠ 在庫の時点: {formatDateTime(stockAsOf)}（{hoursAgo}時間前）。最新のCSVを取り込んでから答えることをおすすめします。
          </Alert>
        ) : (
          <p className="text-sm text-ink-muted">
            在庫の時点: {formatDateTime(stockAsOf)}（{hoursAgo}時間前）
          </p>
        ))}
      {answer.warnings.filter((w) => !w.startsWith("在庫の時点")).length > 0 && (
        <Alert tone="warning">
          <ul className="flex flex-col gap-1">
            {answer.warnings
              .filter((w) => !w.startsWith("在庫の時点"))
              .map((w) => (
                <li key={w}>{w}</li>
              ))}
          </ul>
        </Alert>
      )}

      <Field id="stock_template_id" label="ひな形">
        <Select id="stock_template_id" name="template_id" defaultValue="" className="w-72">
          <option value="">（判定に合うものを使う）</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {templates.length === 0 && (
        <p className="text-sm text-ink-muted">在庫のひな形がまだありません。「返信のひな形」の画面で作ってください。</p>
      )}

      <div className="flex flex-wrap gap-2">
        <ModeButton mode="ai" variant="primary" disabled={!canCreate || aiStopped || busy}>
          AIで返信文の案を作る
        </ModeButton>
        <ModeButton mode="template" variant="secondary" disabled={!canCreate || busy}>
          ひな形で案を作る
        </ModeButton>
      </div>
      {aiStopped && <p className="text-sm text-ink-muted">AIが停止中のため、「ひな形で案を作る」を使ってください。</p>}
    </form>
  );
}
