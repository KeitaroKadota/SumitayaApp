"use client";

// E-07 G03 経費の一覧の表と「選んだものを承認する」(02 G03、03 EV-14)。
// 選べるのは「問題なし」のタブで、expenses_approve の人だけ(要確認のものは G04 で1件ずつ見て承認する。CH-14)。
// 選んだ件数・合計は画面で数え、確認のダイアログ(「5件（12,340円）を承認してよいですか？」)を出してから送る。
import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Badge, type BadgeTone } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { formatQuantity, formatYen } from "@/utils/format";

export type ExpenseRow = {
  id: string;
  version: string;
  href: string;
  submittedLabel: string;
  applicant: string;
  spentLabel: string;
  payee: string;
  total: number;
  title: string;
  status: { label: string; tone: BadgeTone };
  flag: string | null;
};

function BulkButton({ count, sum }: { count: number; sum: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      className={buttonClassName("primary")}
      onClick={(e) => {
        if (!window.confirm(`${count}件（${formatYen(sum)}）を承認してよいですか？`)) e.preventDefault();
      }}
    >
      {pending ? "承認中…" : `選んだものを承認する（${count}件 ${formatYen(sum, "included")}）`}
    </button>
  );
}

export function ExpenseTable({
  rows,
  selectable,
  showStatus,
  action,
  back,
}: {
  rows: ExpenseRow[];
  selectable: boolean;
  showStatus: boolean;
  action: (formData: FormData) => Promise<void>;
  back: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const chosen = rows.filter((r) => selected.has(r.id));
  const sum = chosen.reduce((s, r) => s + r.total, 0);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="back" value={back} />
      {chosen.map((r) => (
        <input key={r.id} type="hidden" name="item" value={`${r.id}:${r.version}`} />
      ))}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left">
            <tr>
              {selectable && (
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="すべて選ぶ"
                    className="size-5 accent-primary"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              <th className="px-3 py-2">申請日</th>
              <th className="px-3 py-2">申請者</th>
              <th className="px-3 py-2">支払日</th>
              <th className="px-3 py-2">支払先</th>
              <th className="px-3 py-2 text-right">合計（税込・円）</th>
              <th className="px-3 py-2">科目</th>
              {showStatus && <th className="px-3 py-2">状態</th>}
              <th className="px-3 py-2">印</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                {selectable && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${r.applicant} ${r.payee} を選ぶ`}
                      className="size-5 accent-primary"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                )}
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.submittedLabel}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.applicant}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.spentLabel}</td>
                <td className="px-3 py-2 break-words">
                  <Link href={r.href} scroll={false} className="font-bold text-primary hover:underline">
                    {r.payee}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(r.total)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.title}</td>
                {showStatus && (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge tone={r.status.tone}>{r.status.label}</Badge>
                  </td>
                )}
                <td className="px-3 py-2">{r.flag && <Badge tone="warning">⚠{r.flag}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectable && (
        <div>
          <BulkButton count={chosen.length} sum={sum} />
        </div>
      )}
    </form>
  );
}
