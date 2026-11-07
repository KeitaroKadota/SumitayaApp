// G03 全員の経費の一覧の URL(?month=・?applicant=・?title=・?check=)の組み立て(E-07 03 EV-11 手順1)。DBを読まない。

export const ADMIN_LIST_URL = "/admin/expenses";

export type AdminListQuery = {
  month?: string;
  applicant?: string;
  title?: string;
  // 要確認だけ(印のあるものだけ)
  check?: boolean;
};

export const adminListUrl = (q: AdminListQuery = {}, path = ADMIN_LIST_URL): string => {
  const sp = new URLSearchParams();
  if (q.month) sp.set("month", q.month);
  if (q.applicant) sp.set("applicant", q.applicant);
  if (q.title) sp.set("title", q.title);
  if (q.check) sp.set("check", "1");
  const qs = sp.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
};
