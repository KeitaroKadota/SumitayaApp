import { requireAccess } from "@/utils/auth";
import { adminExpenseUrl, isExpenseId } from "@/utils/expenseClaimsServer";
import { redirect } from "next/navigation";
import { ExpensesScreen } from "../ExpensesScreen";
import { ADMIN_LIST_URL } from "../expensesAdminUrl";

// G04 経費の詳細(見るだけ。E-07 03 EV-12)。G03 の上にモーダルで出す。機能キー expenses_admin(社長だけ)
export default async function AdminExpenseDetailPage({ params, searchParams }: PageProps<"/admin/expenses/[id]">) {
  const { id } = await params;
  await requireAccess("expenses_admin", adminExpenseUrl(id));
  if (!isExpenseId(id)) redirect(ADMIN_LIST_URL);
  return <ExpensesScreen searchParams={await searchParams} openId={id} />;
}
