import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatRoles } from "@/utils/permissions";
import { DEPARTMENTS, EMPLOYMENT_TYPES } from "@/utils/masterRules";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { EmptyState } from "@/components/EmptyState";
import { LinkButton } from "@/components/LinkButton";
import { LOGIN_STATUS_LABELS, listEmployeesForAdmin } from "./employeeData";

// G01 従業員の一覧(CMN-02 EV-01)
export default async function EmployeesPage({ searchParams }: PageProps<"/admin/employees">) {
  await requireAccess("employees", "/admin/employees");
  const params = await searchParams;
  // 「在籍中だけ表示」はチェックがあるのが既定。外したとき(all=1 だけが送られたとき)に退職者も出す
  const includeRetired = params.all === "1" && params.active !== "1";
  const employees = await listEmployeesForAdmin(includeRetired);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">従業員</h1>
        <LinkButton href="/admin/employees/new" variant="primary">
          ＋ 新規登録
        </LinkButton>
      </div>

      <form method="get">
        <input type="hidden" name="all" value="1" />
        <AutoSubmitCheckbox name="active" label="在籍中だけ表示" defaultChecked={!includeRetired} />
      </form>

      {employees.length === 0 ? (
        <EmptyState
          message="従業員はまだありません。"
          action={
            <LinkButton href="/admin/employees/new" variant="primary">
              ＋ 新規登録
            </LinkButton>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">社員番号</th>
                <th className="px-3 py-2">氏名</th>
                <th className="px-3 py-2">所属</th>
                <th className="px-3 py-2">雇用形態</th>
                <th className="px-3 py-2">権限</th>
                <th className="px-3 py-2">打刻</th>
                <th className="px-3 py-2">ログイン</th>
                <th className="px-3 py-2">LINE通知</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                  <td className="px-3 py-2 tabular-nums">{e.employeeCode}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/employees/${e.id}`} className="font-bold text-primary hover:underline">
                      {e.lastName} {e.firstName}
                    </Link>
                    {!e.isActive && <span className="ml-1 text-ink-muted">（退職）</span>}
                  </td>
                  <td className="px-3 py-2">{DEPARTMENTS[e.department]}</td>
                  <td className="px-3 py-2">{EMPLOYMENT_TYPES[e.employmentType]}</td>
                  <td className="px-3 py-2">{formatRoles(e.roles)}</td>
                  <td className="px-3 py-2">{!e.usesTimecard ? "しない" : (e.homeLocationName ?? "対象")}</td>
                  <td className="px-3 py-2">{e.isActive ? LOGIN_STATUS_LABELS[e.loginStatus] : "—"}</td>
                  {/* LINE通知の状態は CMN-03 が書く列(line_user_id)を見るだけ */}
                  <td className="px-3 py-2">{e.isActive ? (e.lineLinked ? "連携済み" : "未連携") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
