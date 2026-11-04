// G01 入金消込の URL(?tab=・?account=・?month=)の組み立てと読み取り(E-06 03 EV-01 手順1)。DBを読まない。
import type { MatchStatus } from "@/utils/deposits";

export const DEPOSITS_URL = "/admin/deposits";

// 入金のタブ(未消込・消込済み・対象外)と、未入金の請求書のタブ
export type DepositsTab = MatchStatus | "invoices";
export const DEPOSITS_TABS: { key: DepositsTab; label: string }[] = [
  { key: "unmatched", label: "入金 未消込" },
  { key: "matched", label: "消込済み" },
  { key: "ignored", label: "対象外" },
  { key: "invoices", label: "未入金の請求書" },
];
export const isDepositsTab = (v: string): v is DepositsTab => DEPOSITS_TABS.some((t) => t.key === v);

export const isMonthStr = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export const shiftMonth = (month: string, diff: number): string => {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + diff;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};

export type DepositsQuery = {
  tab?: DepositsTab;
  account?: string;
  month?: string;
  // G03 請求書を選んで消込(モーダル)を開く入金
  select?: string;
  done?: string;
  error?: string;
  // 完了の文に入れる値(請求書番号・件数など)
  detail?: string;
};

export const depositsUrl = (q: DepositsQuery = {}): string => {
  const sp = new URLSearchParams();
  if (q.tab && q.tab !== "unmatched") sp.set("tab", q.tab);
  if (q.account) sp.set("account", q.account);
  if (q.month) sp.set("month", q.month);
  if (q.select) sp.set("select", q.select);
  if (q.done) sp.set("done", q.done);
  if (q.error) sp.set("error", q.error);
  if (q.detail) sp.set("detail", q.detail);
  const qs = sp.toString();
  return `${DEPOSITS_URL}${qs ? `?${qs}` : ""}`;
};
export const ACCOUNTS_URL = `${DEPOSITS_URL}/accounts`;
export const IMPORT_URL = `${DEPOSITS_URL}/import`;
