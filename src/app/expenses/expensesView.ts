// 経費(E-07)の画面で使う表示の決まり(02 の G01〜G04)と、月の切り替え。DBを読まない。
import type { BadgeTone } from "@/components/Badge";
import type { ExpenseStatus } from "@/utils/expenseClaims";

// 状態の Badge(02 G01: 下書き・承認待ち・取り下げ＝neutral、差し戻し＝danger、承認済み＝success)
export const EXPENSE_STATUS_TONES: Record<ExpenseStatus, BadgeTone> = {
  draft: "neutral",
  submitted: "neutral",
  returned: "danger",
  approved: "success",
  withdrawn: "neutral",
};

export const isMonthStr = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export const shiftMonth = (month: string, diff: number): string => {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + diff;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};

// その月の初日と最後の日
export const monthRange = (month: string): { from: string; to: string } => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};

// AIで読めなかった理由(?ai=。G02 に「AIの案を作れませんでした。手で入力してください。」を出す)
export const aiFailCode = (reason: string): string => (reason === "quota" || reason === "disabled" ? reason : "failed");
