import { requireAccess } from "@/utils/auth";
import { ExpensesScreen } from "./ExpensesScreen";
import { ADMIN_LIST_URL } from "./expensesAdminUrl";

// G03 経費の承認(E-07 03 EV-11)。機能キー expenses_admin(社長・経理)。承認のボタンは expenses_approve の人にだけ出す
export default async function AdminExpensesPage({ searchParams }: PageProps<"/admin/expenses">) {
  const me = await requireAccess("expenses_admin", ADMIN_LIST_URL);
  return <ExpensesScreen me={me} searchParams={await searchParams} />;
}
