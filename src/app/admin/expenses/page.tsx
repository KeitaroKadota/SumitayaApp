import { requireAccess } from "@/utils/auth";
import { ExpensesScreen } from "./ExpensesScreen";
import { ADMIN_LIST_URL } from "./expensesAdminUrl";

// G03 全員の経費の一覧(E-07 03 EV-11)。機能キー expenses_admin(社長だけ。No.46)
export default async function AdminExpensesPage({ searchParams }: PageProps<"/admin/expenses">) {
  await requireAccess("expenses_admin", ADMIN_LIST_URL);
  return <ExpensesScreen searchParams={await searchParams} />;
}
