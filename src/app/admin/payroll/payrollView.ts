// 給与CSVの画面(E-03 の G01〜G03)で共通の、URL・期間の文(DBを読まない)。
import { formatDateShort, formatYearMonth } from "@/utils/format";
import { addDays } from "@/utils/holidays";
import { payrollPeriodOf, payrollPeriodOfMonth, shiftPayrollPeriod, type PayrollPeriod } from "@/utils/payrollPeriod";
import { PAYROLL_FIRST_MONTH } from "@/utils/payrollRules";

const MONTH_PATTERN = /^(20\d{2})-(0[1-9]|1[0-2])$/;

export const payrollUrl = (month: string, extra = "") => `/admin/payroll?month=${month}${extra}`;

// 2026年11月分
export const periodLabel = (p: PayrollPeriod) => `${formatYearMonth(Number(p.month.slice(0, 4)), Number(p.month.slice(5)))}分`;

// CH-01 選べる月か(YYYY-MM の形で、最初の月以後、今日を含む期間の月以前)
export const isSelectableMonth = (month: string, today: string): boolean =>
  MONTH_PATTERN.test(month) && month >= PAYROLL_FIRST_MONTH && payrollPeriodOfMonth(month).from <= payrollPeriodOf(today).from;

// EV-01 手順1 ?month= を確かめる。だめなら今日を含む期間の1つ前(最初の月より前なら最初の月)
export const parsePayrollMonth = (value: string | string[] | undefined, today: string): PayrollPeriod => {
  if (typeof value === "string" && isSelectableMonth(value, today)) return payrollPeriodOfMonth(value);
  const prev = shiftPayrollPeriod(payrollPeriodOf(today), -1);
  return prev.month >= PAYROLL_FIRST_MONTH ? prev : payrollPeriodOfMonth(PAYROLL_FIRST_MONTH);
};

// CH-02 期間が終わっているか(今日が終了日より後)。だめなら理由の文
export const periodNotEndedMessage = (period: PayrollPeriod, today: string): string | null =>
  today > period.to ? null : `${formatDateShort(period.to)}までの期間なので、${formatDateShort(addDays(period.to, 1))}から締められます。`;
