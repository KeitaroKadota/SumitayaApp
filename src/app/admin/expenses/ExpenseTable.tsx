// E-07 G03 全員の経費の一覧の表(02 G03)。行の支払先を押すと G04(詳細のモーダル)を開く。
// 0.4 で承認の段階をなくしたため、選んでまとめて承認する欄は外した(見るだけ)。
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { formatQuantity } from "@/utils/format";

export type ExpenseRow = {
  id: string;
  href: string;
  confirmedLabel: string;
  applicant: string;
  spentLabel: string;
  payee: string;
  total: number;
  title: string;
  flag: string | null;
};

export function ExpenseTable({ rows }: { rows: ExpenseRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas text-left">
          <tr>
            <th className="px-3 py-2">登録日</th>
            <th className="px-3 py-2">登録した人</th>
            <th className="px-3 py-2">支払日</th>
            <th className="px-3 py-2">支払先</th>
            <th className="px-3 py-2 text-right">合計（税込・円）</th>
            <th className="px-3 py-2">科目</th>
            <th className="px-3 py-2">印</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line align-top last:border-b-0">
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.confirmedLabel}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.applicant}</td>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.spentLabel}</td>
              <td className="px-3 py-2 break-words">
                <Link href={r.href} scroll={false} className="font-bold text-primary hover:underline">
                  {r.payee}
                </Link>
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(r.total)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.title}</td>
              <td className="px-3 py-2">{r.flag && <Badge tone="warning">⚠{r.flag}</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
