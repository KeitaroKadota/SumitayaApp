import { requireAccess } from "@/utils/auth";
import { canAccess } from "@/utils/permissions";
import { DEPARTMENTS } from "@/utils/masterRules";
import { formatDate } from "@/utils/format";
import { getLineLinkStatus } from "@/utils/lineAccount";
import { LINE_TEST_MESSAGES, isLineTestResult } from "@/utils/lineTest";
import { countOpenTasksOfEmployee } from "@/utils/tasks";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { AccountPanel } from "../AccountPanel";
import { ACCOUNT_DONE_MESSAGES } from "../accountMessages";
import { reinstateEmployeeAction, retireEmployeeAction, saveEmployee } from "../actions";
import { getEmployeeDetail, listWorkLocations } from "../employeeData";
import { EmployeeAccountFields, EmployeeForm } from "../EmployeeForm";
import { LinePanel } from "../LinePanel";
import { RetireSection } from "./RetireSection";

const SAVED_MESSAGES: Record<string, string> = {
  "1": "保存しました。",
  retired: "退職を登録しました。",
  reinstated: "在籍に戻しました。",
};

// G03 従業員の詳細・編集(CMN-02 EV-03)。CMN-01 の G07 アカウント欄を中に置く
export default async function EmployeeDetailPage({ params, searchParams }: PageProps<"/admin/employees/[id]">) {
  const { id } = await params;
  const me = await requireAccess("employees", `/admin/employees/${id}`);
  const query = await searchParams;

  const employee = await getEmployeeDetail(id);
  if (!employee) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/employees" label="一覧へ" />
        </div>
        <Alert tone="error">この従業員は見つかりません。</Alert>
      </div>
    );
  }

  // 主な勤務場所の選択肢: 使用中の場所と、今の値(使用中でなくても残す。CH-30)
  const locations = (await listWorkLocations()).filter((l) => l.isActive || l.id === employee.homeLocationId);
  // CH-07 その人が担当の未完了のタスクの件数(CMN-03 の関数。退職の確認のダイアログ用)
  const openTaskCount = await countOpenTasksOfEmployee(employee.id);
  // LINE通知欄(CMN-03)は全員のタスクを使える人(社長)だけに出す
  const lineStatus = canAccess(me.roles, "tasks_admin") ? await getLineLinkStatus(employee.id) : null;
  const lineTest = isLineTestResult(query.line_test) ? LINE_TEST_MESSAGES[query.line_test] : null;

  const saved = typeof query.saved === "string" ? SAVED_MESSAGES[query.saved] : undefined;
  const done = typeof query.done === "string" ? ACCOUNT_DONE_MESSAGES[query.done] : undefined;
  const readOnly = !employee.isActive;

  const accountFields = <EmployeeAccountFields />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/employees" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">
        {employee.lastName} {employee.firstName}（{DEPARTMENTS[employee.department]}・{employee.isActive ? "在籍中" : "退職"}）
      </h1>

      {query.created === "1" && <Alert tone="success">登録しました。初期パスワードは下のアカウント欄で発行してください。</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}
      {done && <Alert tone={done.tone}>{done.text}</Alert>}
      {lineTest && <Alert tone={lineTest.tone}>{lineTest.text}</Alert>}
      {query.line_unlinked === "1" && <Alert tone="success">LINE通知の連携を解除しました。</Alert>}
      {query.warn === "email_dup" && (
        <Alert tone="warning">同じメールアドレスの従業員がほかにいます。初期パスワードなどのメールは、その人の名前あてに届きます。</Alert>
      )}
      {readOnly && <Alert tone="info">退職者は編集できません。編集するときは「在籍に戻す」を押してください。</Alert>}

      <EmployeeForm
        key={employee.id}
        mode="edit"
        action={saveEmployee.bind(null, employee.id)}
        readOnly={readOnly}
        locations={locations}
        initialValues={{
          employee_code: employee.employeeCode,
          last_name: employee.lastName,
          first_name: employee.firstName,
          last_name_kana: employee.lastNameKana ?? "",
          first_name_kana: employee.firstNameKana ?? "",
          department: employee.department,
          employment_type: employee.employmentType,
          email: employee.email ?? "",
          hired_on: employee.hiredOn ?? "",
          uses_timecard: employee.usesTimecard ? "1" : "0",
          home_location_id: employee.homeLocationId ?? "",
          note: employee.note ?? "",
          login_id: employee.loginId ?? "",
          roles: employee.roles.join(","),
        }}
        accountSlot={
          // アカウント欄(CMN-01 G07)は社長(accounts)だけに出す。employees も社長だけの機能なので、通常は必ず出る
          canAccess(me.roles, "accounts") ? (
            <AccountPanel
              employee={{
                id: employee.id,
                lastName: employee.lastName,
                firstName: employee.firstName,
                email: employee.email,
                loginId: employee.loginId,
                hasPassword: employee.hasPassword,
                mustChangePassword: employee.mustChangePassword,
                lockedUntil: employee.lockedUntil,
                lastLoginAt: employee.lastLoginAt,
                isActive: employee.isActive,
              }}
            >
              {accountFields}
            </AccountPanel>
          ) : (
            <section className="rounded-lg border border-line bg-surface p-5">{accountFields}</section>
          )
        }
      />

      {/* LINE通知欄(CMN-03 EV-13・EV-14。状態・テスト送信・連携の解除) */}
      {lineStatus && (
        <LinePanel employeeId={employee.id} name={`${employee.lastName} ${employee.firstName}`} status={lineStatus} />
      )}

      <RetireSection
        isActive={employee.isActive}
        retiredOnLabel={employee.retiredOn ? formatDate(employee.retiredOn) : null}
        openTaskCount={openTaskCount}
        retireAction={retireEmployeeAction.bind(null, employee.id)}
        reinstateAction={reinstateEmployeeAction.bind(null, employee.id)}
      />
    </div>
  );
}
