"use client";

// G01 の「対象外にする」の小さな画面と、G03 請求書を選んで消込の一覧(E-06 02 G01・G03、03 EV-05・EV-06・EV-08)。
import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { LinkButton } from "@/components/LinkButton";
import { formatQuantity, formatYen } from "@/utils/format";
import { IGNORE_REASONS, MAX_IGNORE_MEMO } from "@/utils/deposits";

// 戻る先(タブ・口座・月)の隠し項目
export function BackFields({ tab, account, month }: { tab: string; account: string; month: string }) {
  return (
    <>
      <input type="hidden" name="back_tab" value={tab} />
      <input type="hidden" name="back_account" value={account} />
      <input type="hidden" name="back_month" value={month} />
    </>
  );
}

// EV-08 手順1「対象外にする」: 理由(選択)＋メモ
export function IgnoreButton({
  txnId,
  label,
  back,
  action,
}: {
  txnId: string;
  label: string;
  back: { tab: string; account: string; month: string };
  action: (formData: FormData) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => dialogRef.current?.showModal()}>
        対象外にする
      </Button>
      {/* dialog は Esc で閉じる(00_画面共通ルール 10章) */}
      <dialog
        ref={dialogRef}
        aria-label={`${label}を対象外にする`}
        className="m-auto w-full max-w-md rounded-lg border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <form action={action} className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">対象外にする</h2>
          <p className="text-sm">{label}</p>
          <input type="hidden" name="txn_id" value={txnId} />
          <BackFields {...back} />
          <Field id={`reason-${txnId}`} label="理由" required>
            <Select id={`reason-${txnId}`} name="reason" required defaultValue="">
              <option value="" disabled>
                選んでください
              </option>
              {IGNORE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`memo-${txnId}`} label="メモ" description={`${MAX_IGNORE_MEMO}文字まで`}>
            <TextInput id={`memo-${txnId}`} name="memo" maxLength={MAX_IGNORE_MEMO} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
              キャンセル
            </Button>
            <SubmitButton pendingText="保存中…">対象外にする</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

export type SelectableInvoice = {
  id: string;
  invoiceNo: string;
  addressee: string;
  total: number;
  dueLabel: string;
  // 入金額 − ご請求額(EV-05 手順3)
  diff: number;
  selectable: boolean;
  reason: string | null;
};

// G03 の一覧と「消込する」。差額は選んだ請求書のものを出す
export function SelectInvoiceForm({
  txnId,
  version,
  invoices,
  defaultInvoiceId,
  back,
  closeHref,
  action,
}: {
  txnId: string;
  version: string;
  invoices: SelectableInvoice[];
  defaultInvoiceId: string | null;
  back: { tab: string; account: string; month: string };
  closeHref: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(defaultInvoiceId);
  const current = invoices.find((i) => i.id === selected) ?? null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="txn_id" value={txnId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="from" value="modal" />
      <BackFields {...back} />
      {invoices.length === 0 ? (
        <p className="text-sm text-ink-muted">選べる請求書がありません（発行済み・未入金で、入金日より前に発行したものを出します）。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">
                  <span className="sr-only">選ぶ</span>
                </th>
                <th className="px-3 py-2">番号</th>
                <th className="px-3 py-2">取引先</th>
                <th className="px-3 py-2 text-right">ご請求額（税込・円）</th>
                <th className="px-3 py-2">期限</th>
                <th className="px-3 py-2 text-right">差（円）</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className={`border-b border-line align-top last:border-b-0 ${i.selectable ? "" : "text-ink-muted"}`}>
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name="invoice_id"
                      value={i.id}
                      disabled={!i.selectable}
                      checked={selected === i.id}
                      onChange={() => setSelected(i.id)}
                      aria-label={`${i.invoiceNo}を選ぶ`}
                      className="size-5 accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{i.invoiceNo}</td>
                  <td className="px-3 py-2 break-words">
                    {i.addressee}
                    {i.reason && <p className="text-xs">⚠ {i.reason}</p>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(i.total)}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{i.dueLabel}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(i.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm font-bold tabular-nums">
        差額 {current ? formatYen(current.diff) : "−"}
        {current && current.diff < 0 && <span className="ml-2 font-normal">（{formatYen(-current.diff)}を振込手数料として記録します）</span>}
      </p>
      <div className="flex justify-end gap-2">
        <LinkButton href={closeHref}>キャンセル</LinkButton>
        <SubmitButton pendingText="消込中…" disabled={!current?.selectable}>
          消込する
        </SubmitButton>
      </div>
    </form>
  );
}
