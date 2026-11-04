import { requireAccess } from "@/utils/auth";
import { adminExpenseUrl, isExpenseId } from "@/utils/expenseClaimsServer";
import { redirect } from "next/navigation";
import { ExpensesScreen } from "../ExpensesScreen";
import { ADMIN_LIST_URL } from "../expensesAdminUrl";

// G04 経費の詳細・承認(E-07 03 EV-12)。G03 の上にモーダルで出す。機能キー expenses_admin
export default async function AdminExpenseDetailPage({ params, searchParams }: PageProps<"/admin/expenses/[id]">) {
  const { id } = await params;
  const me = await requireAccess("expenses_admin", adminExpenseUrl(id));
  if (!isExpenseId(id)) redirect(ADMIN_LIST_URL);
  return <ExpensesScreen me={me} searchParams={await searchParams} openId={id} />;
}
