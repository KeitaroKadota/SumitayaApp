// G03 経費の承認の URL(?tab=・?month=・?applicant=・?title=)の組み立てと読み取り(E-07 03 EV-11 手順1)。DBを読まない。
import type { AdminExpenseTab } from "@/utils/expenseClaimsServer";

export const ADMIN_LIST_URL = "/admin/expenses";

// 承認待ちを「要確認」(check_flags が1つ以上)と「問題なし」に分ける。最初は「要確認」(02 G03)
export const ADMIN_TABS: { key: AdminExpenseTab; label: string }[] = [
  { key: "needs_check", label: "承認待ち・要確認" },
  { key: "ok", label: "承認待ち・問題なし" },
  { key: "returned", label: "差し戻し中" },
  { key: "approved", label: "承認済み" },
  { key: "all", label: "すべて" },
];
export const isAdminTab = (v: string): v is AdminExpenseTab => ADMIN_TABS.some((t) => t.key === v);

export type AdminListQuery = {
  tab?: AdminExpenseTab;
  month?: string;
  applicant?: string;
  title?: string;
  done?: string;
  error?: string;
  detail?: string;
};

export const adminListUrl = (q: AdminListQuery = {}, path = ADMIN_LIST_URL): string => {
  const sp = new URLSearchParams();
  if (q.tab && q.tab !== "needs_check") sp.set("tab", q.tab);
  if (q.month) sp.set("month", q.month);
  if (q.applicant) sp.set("applicant", q.applicant);
  if (q.title) sp.set("title", q.title);
  if (q.done) sp.set("done", q.done);
  if (q.error) sp.set("error", q.error);
  if (q.detail) sp.set("detail", q.detail);
  const qs = sp.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
};

// 操作のあとに戻る一覧の URL(フォームの back)。経費の承認の一覧のほかへは移さない
export const safeAdminBack = (value: string): string => {
  if (!value.startsWith(`${ADMIN_LIST_URL}?`) && value !== ADMIN_LIST_URL) return ADMIN_LIST_URL;
  if (value.includes("//") || value.includes("\\")) return ADMIN_LIST_URL;
  // 前の done・error は外す
  const [path, qs = ""] = value.split("?");
  const sp = new URLSearchParams(qs);
  sp.delete("done");
  sp.delete("error");
  sp.delete("detail");
  const rest = sp.toString();
  return `${path}${rest ? `?${rest}` : ""}`;
};

export const withMessage = (back: string, message: { done?: string; error?: string; detail?: string }): string => {
  const [path, qs = ""] = back.split("?");
  const sp = new URLSearchParams(qs);
  if (message.done) sp.set("done", message.done);
  if (message.error) sp.set("error", message.error);
  if (message.detail) sp.set("detail", message.detail);
  const rest = sp.toString();
  return `${path}${rest ? `?${rest}` : ""}`;
};
