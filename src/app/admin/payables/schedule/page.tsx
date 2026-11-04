import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatQuantity, formatYearMonth, formatYen } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { PAYABLE_STATUSES, PAYMENT_METHODS } from "@/utils/payables";
import { listScheduleOfMonth, type Payable } from "@/utils/payablesServer";
import { Badge } from "@/components/Badge";
import { BackLink } from "@/components/LinkButton";
import { EmptyState } from "@/components/EmptyState";
import { PeriodNav } from "@/components/PeriodNav";
import { LIST_URL, SCHEDULE_URL, STATUS_TONES } from "../payablesView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const sumOf = (rows: Payable[]) => rows.reduce((s, r) => s + r.amountDue, 0);

function ScheduleTable({ rows }: { rows: Payable[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas text-left">
          <tr>
            <th className="px-3 py-2">請求元</th>
            <th className="px-3 py-2 text-right">ご請求額（税込・円）</th>
            <th className="px-3 py-2">支払方法</th>
            <th className="px-3 py-2">振込先</th>
            <th className="px-3 py-2">状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
              <td className="px-3 py-2">
                <Link href={`/admin/payables/${r.id}`} className="font-bold text-primary hover:underline">
                  {r.payeeName ?? r.supplierName ?? "（請求元の名前なし）"}
                </Link>
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(r.amountDue)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.paymentMethod ? PAYMENT_METHODS[r.paymentMethod] : "−"}</td>
              <td className="px-3 py-2 break-words">{r.transferTo ?? "−"}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Badge tone={STATUS_TONES[r.status]}>{PAYABLE_STATUSES[r.status]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// G04 支払予定(E-04 03 EV-11)。支払予定日ごとにまとめ、件数と合計を出す(金額はDBの値を足すだけ)
export default async function PayableSchedulePage({ searchParams }: PageProps<"/admin/payables/schedule">) {
  await requireAccess("payables", SCHEDULE_URL);
  const params = await searchParams;

  // 手順1: ?month=YYYY-MM(なければ今月)
  const monthParam = str(params.month);
  const today = todayJST();
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam);
  const year = Number((valid ? monthParam : today).slice(0, 4));
  const month = Number((valid ? monthParam : today).slice(5, 7));
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(lastDay(year, month))}`;
  const shift = (d: number) => {
    const t = year * 12 + (month - 1) + d;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  };

  // 手順2〜4
  const { dated, undated } = await listScheduleOfMonth(from, to);
  const byDay = new Map<string, Payable[]>();
  for (const r of dated) if (r.dueOn) byDay.set(r.dueOn, [...(byDay.get(r.dueOn) ?? []), r]);
  const pending = dated.filter((r) => r.status === "needs_review");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href={LIST_URL} label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">支払予定</h1>
      <PeriodNav
        label={formatYearMonth(year, month)}
        prev={{ href: `${SCHEDULE_URL}?month=${shift(-1)}`, label: "前の月" }}
        next={{ href: `${SCHEDULE_URL}?month=${shift(1)}`, label: "次の月" }}
      />

      <div className="rounded-lg border border-line bg-surface p-4 text-sm tabular-nums">
        <span className="font-bold">合計</span>　支払予定 {formatQuantity(dated.length)}件 {formatYen(sumOf(dated), "included")} ／ うち確認待ち{" "}
        {formatQuantity(pending.length)}件 {formatYen(sumOf(pending), "included")}
      </div>

      {dated.length === 0 && undated.length === 0 ? (
        <EmptyState message="この月の支払予定はまだありません。" />
      ) : (
        <>
          {[...byDay.entries()].map(([day, rows]) => (
            <section key={day} className="flex flex-col gap-2">
              <h2 className="font-bold tabular-nums">
                ■ {formatDateShort(day)}　{formatQuantity(rows.length)}件　{formatYen(sumOf(rows), "included")}
              </h2>
              <ScheduleTable rows={rows} />
            </section>
          ))}
          {undated.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-bold tabular-nums">
                ■ 支払予定日が未定　{formatQuantity(undated.length)}件　{formatYen(sumOf(undated), "included")}
              </h2>
              <ScheduleTable rows={undated} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
