// 給与の対象期間と締め済みの判定(E-03 01 5.1・9章、00_共通設計 4章)。担当は E-03。E-01・E-02 が使う。
// 期間は終わりの日の月で呼ぶ(20日締めの 10/21〜11/20 は「11月分」)。
// 【仮】期間は締め日の定数だけで決める。締め日の定数を直したときに、保存した期間から引き継ぐ処理(03 の 0.1 手順1・2)は
// 作っていない(00_仮決め一覧 E-03-仮-09)。締め済みの判定(isPayrollClosed)は、保存した期間(payroll_exports)で行う。
import { cache } from "react";
import { query } from "@/utils/db";
import { addDays } from "@/utils/holidays";
import { PAYROLL_CLOSING_DAY } from "@/utils/payrollRules";

export type PayrollPeriod = {
  // 呼び方の月 "YYYY-MM"
  month: string;
  from: string;
  to: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const shiftMonthKey = (month: string, diff: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + diff, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
};

// その月の締め日 "YYYY-MM-DD"(その月に無い日は最後の日)
const closingDateOf = (month: string, closingDay: number): string => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad2(Math.min(closingDay, daysInMonth(y, m)))}`;
};

// "YYYY-MM" の給与の対象期間
export const payrollPeriodOfMonth = (month: string, closingDay: number = PAYROLL_CLOSING_DAY): PayrollPeriod => ({
  month,
  from: addDays(closingDateOf(shiftMonthKey(month, -1), closingDay), 1),
  to: closingDateOf(month, closingDay),
});

// その日を含む給与の対象期間
export const payrollPeriodOf = (date: string, closingDay: number = PAYROLL_CLOSING_DAY): PayrollPeriod => {
  const month = date.slice(0, 7);
  return date <= closingDateOf(month, closingDay)
    ? payrollPeriodOfMonth(month, closingDay)
    : payrollPeriodOfMonth(shiftMonthKey(month, 1), closingDay);
};

// 前・次の期間
export const shiftPayrollPeriod = (period: PayrollPeriod, diff: number): PayrollPeriod =>
  payrollPeriodOfMonth(shiftMonthKey(period.month, diff));

// 締め済みの期間の一覧(1回の表示の中では1回だけ読む。React の cache。画面の外では毎回読む)
const closedPeriods = cache(
  async (): Promise<{ from: string; to: string }[]> =>
    await query(
      (sql) => sql<{ from: string; to: string }[]>`
        select to_char(period_start, 'YYYY-MM-DD') as "from", to_char(period_end, 'YYYY-MM-DD') as "to"
        from payroll_exports where status = 'closed'`
    )
);

// 03 の 0.2 その日を含む期間が締め済みか(payroll_exports の status が closed)。
// トランザクションの中からは呼ばない(DBの接続1本の決まりで、トランザクションが終わるまで待ってしまうため)
export const isPayrollClosed = async (date: string): Promise<boolean> =>
  (await closedPeriods()).some((p) => p.from <= date && date <= p.to);
