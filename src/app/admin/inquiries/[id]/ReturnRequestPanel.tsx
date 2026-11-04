"use client";

// D-06 G01 返品のパネル(03 EV-01〜EV-06)。D-01 の詳細画面(G04)の中に、種類が返品のときに出す。
// 注文を探す・選ぶたびにサーバーから読み直す(保存はしない)。案を作る・受付を登録するときは、
// 選んだ明細のIDと数だけを送り、サーバーで注文を読み直して確かめる(04 CH-02〜CH-05)。
import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/Alert";
import { Button, buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import { SHOP_LABELS } from "@/utils/crossmall/types";
import { formatDateShort, formatYen } from "@/utils/format";
import type { ReturnOrder, ReturnOrderOption } from "@/utils/returnRequests";
import { RETURN_DECISIONS, RETURN_LIMITS, RETURN_REASONS, REQUEST_TYPES, SHIPPING_PAID_BY } from "@/utils/returnRules";
import { loadReturnOrderForPanel, searchOrdersForReturnPanel, type ReturnPanelState } from "../returnReplyActions";

type Mode = "ai" | "template" | "register";

// 押したボタンの mode をフォームの値に入れて送る
function ModeButton({
  mode,
  variant,
  disabled,
  children,
}: {
  mode: Mode;
  variant: "primary" | "secondary";
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("mode") === mode;
  return (
    <button type="submit" name="mode" value={mode} disabled={pending || disabled} className={buttonClassName(variant)}>
      {mine ? (mode === "register" ? "登録中…" : "作成中…") : children}
    </button>
  );
}

type ItemState = { checked: boolean; qty: string; exchangeId: string; exchangeCode: string };
type ManualRow = { name: string; qty: string; exchangeCode: string };

const emptyManualRow = (): ManualRow => ({ name: "", qty: "1", exchangeCode: "" });

const orderLine = (o: ReturnOrderOption): string =>
  `${SHOP_LABELS[o.shop]} ${o.orderNo} ${formatDateShort(o.orderedOn)}注文${o.shippedOn ? ` ${formatDateShort(o.shippedOn)}出荷` : ""} ${o.customerName}${o.isCancelled ? "（キャンセル）" : ""}`;

const initialItems = (order: ReturnOrder | null): Record<string, ItemState> =>
  Object.fromEntries((order?.items ?? []).map((i) => [i.id, { checked: order?.items.length === 1, qty: "1", exchangeId: "", exchangeCode: "" }]));

export function ReturnRequestPanel({
  action,
  initialQuery,
  initialCandidates,
  initialOrder,
  initialReason,
  aiStopped,
}: {
  action: (prev: ReturnPanelState, formData: FormData) => Promise<ReturnPanelState>;
  initialQuery: string;
  initialCandidates: ReturnOrderOption[];
  initialOrder: ReturnOrder | null;
  initialReason: string;
  aiStopped: boolean;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  const [q, setQ] = useState(initialQuery);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [order, setOrder] = useState(initialOrder);
  const [items, setItems] = useState(() => initialItems(initialOrder));
  const [manual, setManual] = useState(false);
  const [manualOrderNumber, setManualOrderNumber] = useState(initialQuery);
  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyManualRow()]);
  const [requestType, setRequestType] = useState("return");
  const [reason, setReason] = useState(initialReason);
  const [reasonNote, setReasonNote] = useState("");
  const [decision, setDecision] = useState("");
  const [shipping, setShipping] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // EV-02 「探す」
  const search = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await searchOrdersForReturnPanel(q);
        if (r.ok) setCandidates(r.items);
        else {
          setCandidates([]);
          setMessage(r.message);
        }
      } catch {
        setMessage("探せませんでした。時間をおいてもう一度お試しください。");
      }
    });

  // 手順3: 注文を選んだら、その明細を出す
  const pick = (id: string) =>
    startTransition(async () => {
      setMessage(null);
      setManual(false);
      try {
        const r = await loadReturnOrderForPanel(id);
        if (r.ok) {
          setOrder(r.order);
          setItems(initialItems(r.order));
        } else setMessage(r.message);
      } catch {
        setMessage("注文を読めませんでした。時間をおいてもう一度お試しください。");
      }
    });

  const setItem = (id: string, patch: Partial<ItemState>) => setItems((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const setRow = (i: number, patch: Partial<ManualRow>) => setManualRows((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const exchange = requestType === "exchange";
  const accepting = decision === "accept";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="order_id" value={!manual && order ? order.order.id : ""} />
      <input type="hidden" name="manual" value={manual ? "1" : ""} />

      {/* EV-02 注文を探す(この欄はフォームの値に入れない) */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="return_search" label="注文を探す" description="注文番号・メールアドレス・名前・電話番号">
            <TextInput
              id="return_search"
              value={q}
              maxLength={RETURN_LIMITS.searchMax}
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
            <p className="text-sm font-bold">見つかった注文</p>
            <ul className="flex flex-col">
              {candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="return_order_candidate"
                      value={c.id}
                      checked={!manual && order?.order.id === c.id}
                      onChange={() => pick(c.id)}
                      disabled={busy}
                      className="size-5 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 break-words">{orderLine(c)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <Button variant="secondary" disabled={busy} onClick={() => setManual(true)}>
            注文が見つからない（手で入れる）
          </Button>
        </div>
      </div>

      {/* EV-03 返品する商品 */}
      {manual ? (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <p className="text-sm font-bold">返品する商品（手で入れる）</p>
          <Field id="manual_order_number" label="注文番号">
            <TextInput
              id="manual_order_number"
              name="manual_order_number"
              value={manualOrderNumber}
              maxLength={RETURN_LIMITS.orderNumber}
              onChange={(e) => setManualOrderNumber(e.currentTarget.value)}
              className="w-64"
            />
          </Field>
          {manualRows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field id={`manual_name_${i}`} label={`商品名${i + 1}`}>
                <TextInput
                  id={`manual_name_${i}`}
                  name="manual_name"
                  value={r.name}
                  maxLength={RETURN_LIMITS.productName}
                  onChange={(e) => setRow(i, { name: e.currentTarget.value })}
                  className="w-64"
                />
              </Field>
              <Field id={`manual_qty_${i}`} label="数">
                <TextInput
                  id={`manual_qty_${i}`}
                  name="manual_qty"
                  inputMode="numeric"
                  value={r.qty}
                  onChange={(e) => setRow(i, { qty: e.currentTarget.value })}
                  className="w-16 text-right"
                />
              </Field>
              {exchange && (
                <Field id={`manual_exchange_${i}`} label="交換先の商品コード">
                  <TextInput
                    id={`manual_exchange_${i}`}
                    name="manual_exchange_code"
                    value={r.exchangeCode}
                    onChange={(e) => setRow(i, { exchangeCode: e.currentTarget.value })}
                    className="w-40"
                  />
                </Field>
              )}
            </div>
          ))}
          {manualRows.length < RETURN_LIMITS.manualRows && (
            <div>
              <Button variant="secondary" onClick={() => setManualRows((prev) => [...prev, emptyManualRow()])}>
                ＋ 商品を足す
              </Button>
            </div>
          )}
        </div>
      ) : (
        order && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold">返品する商品（{orderLine(order.order)}）</p>
            <ul className="flex flex-col gap-2">
              {order.items.map((i) => {
                const s = items[i.id];
                return (
                  <li key={i.id} className="flex flex-col gap-1 rounded-md border border-line p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          name="item_id"
                          value={i.id}
                          checked={s?.checked ?? false}
                          onChange={(e) => setItem(i.id, { checked: e.currentTarget.checked })}
                          className="size-5 accent-primary"
                        />
                        <span className="break-words">
                          {i.productName}
                          {i.optionText ? ` ${i.optionText}` : ""}
                        </span>
                      </label>
                      <span className="text-ink-muted">
                        {i.quantity}点 {formatYen(i.unitPrice, "included")}
                      </span>
                      {i.returnedQuantity > 0 && <span className="text-warning">⚠ ほかの返品で{i.returnedQuantity}点を受付済み</span>}
                    </div>
                    {i.hasCustomization && <p className="text-warning">⚠ 名入れ・加工: {i.customizationText ?? "あり"}</p>}
                    {s?.checked && (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field id={`qty_${i.id}`} label="数">
                          <TextInput
                            id={`qty_${i.id}`}
                            name={`qty_${i.id}`}
                            inputMode="numeric"
                            value={s.qty}
                            onChange={(e) => setItem(i.id, { qty: e.currentTarget.value })}
                            className="w-16 text-right"
                          />
                        </Field>
                        {exchange &&
                          (i.exchangeCandidates.length > 0 ? (
                            <Field id={`exchange_${i.id}`} label="交換先">
                              <Select
                                id={`exchange_${i.id}`}
                                name={`exchange_${i.id}`}
                                value={s.exchangeId}
                                onChange={(e) => setItem(i.id, { exchangeId: e.currentTarget.value })}
                                className="w-64"
                              >
                                <option value="">（選んでください）</option>
                                {i.exchangeCandidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.label}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          ) : (
                            <Field id={`exchange_code_${i.id}`} label="交換先の商品コード">
                              <TextInput
                                id={`exchange_code_${i.id}`}
                                name={`exchange_code_${i.id}`}
                                value={s.exchangeCode}
                                onChange={(e) => setItem(i.id, { exchangeCode: e.currentTarget.value })}
                                className="w-40"
                              />
                            </Field>
                          ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}

      <div className="flex flex-wrap items-end gap-4">
        <RadioGroup
          name="request_type"
          label="依頼"
          options={Object.entries(REQUEST_TYPES).map(([value, label]) => ({ value, label }))}
          value={requestType}
          onChange={setRequestType}
        />
        <Field id="return_reason" label="理由">
          <Select id="return_reason" name="reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} className="w-48">
            <option value="">（選んでください）</option>
            {Object.entries(RETURN_REASONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="return_reason_note" label="詳しく">
          <TextInput
            id="return_reason_note"
            name="reason_note"
            value={reasonNote}
            maxLength={RETURN_LIMITS.reasonNote}
            onChange={(e) => setReasonNote(e.currentTarget.value)}
            className="w-64"
          />
        </Field>
      </div>

      {/* CH-04 担当者の決定・送料の負担(初めは空。必ず担当者が選ぶ) */}
      <div className="flex flex-wrap gap-4 rounded-md border border-line p-3">
        <RadioGroup
          name="decision"
          label="担当者の決定"
          options={Object.entries(RETURN_DECISIONS).map(([value, label]) => ({ value, label }))}
          value={decision}
          onChange={setDecision}
        />
        <RadioGroup
          name="shipping_paid_by"
          label="送料の負担"
          options={Object.entries(SHIPPING_PAID_BY).map(([value, label]) => ({ value, label }))}
          value={shipping}
          onChange={setShipping}
        />
      </div>

      {state.error && <Alert tone="error">{state.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <ModeButton mode="ai" variant="primary" disabled={busy || aiStopped || !decision || (accepting && !shipping)}>
          AIで返信文の案を作る
        </ModeButton>
        <ModeButton mode="template" variant="secondary" disabled={busy || !decision || (accepting && !shipping)}>
          ひな形で案を作る
        </ModeButton>
        <ModeButton mode="register" variant="secondary" disabled={busy || (decision !== "accept" && decision !== "reject") || !shipping}>
          受付を登録
        </ModeButton>
      </div>
      {!decision && <p className="text-sm text-ink-muted">担当者の決定を選ぶと、案を作れます。</p>}
      {aiStopped && <p className="text-sm text-ink-muted">AIが停止中のため、「ひな形で案を作る」を使ってください。</p>}
      <p className="text-sm text-ink-muted">返金・交換の処理そのものは、モール・CROSS MALL の画面で行ってください。</p>
    </form>
  );
}
