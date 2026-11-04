import { readIssuedCredential } from "@/utils/issuedCredentials";
import { formatDateTime, formatTime } from "@/utils/format";
import { AccountActionButtons } from "./AccountActionButtons";

// G07 アカウント欄(従業員の詳細画面の一部。CMN-01 02)。従業員の詳細画面は CMN-02 で作り、そこに置く。
// ログインID・権限の入力欄は CMN-02 の「保存」でまとめて保存するので、CMN-02 の画面から children で渡す。
// 呼ぶ側のページで requireAccess("employees", …) を済ませておくこと。この欄は社長(accounts)だけに出す。

export type AccountPanelEmployee = {
  id: string;
  lastName: string;
  firstName: string;
  email: string | null;
  loginId: string | null;
  hasPassword: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  isActive: boolean;
};

export async function AccountPanel({ employee, children }: { employee: AccountPanelEmployee; children?: React.ReactNode }) {
  const name = `${employee.lastName} ${employee.firstName}`;
  // メールで送れなかったときに発行したパスワード(15分だけ。この従業員のものだけ出す)
  const issued = await readIssuedCredential();
  const shown = issued && issued.employeeId === employee.id ? issued : null;
  const locked = employee.lockedUntil && employee.lockedUntil > new Date() ? employee.lockedUntil : null;

  const status = !employee.hasPassword ? "未発行" : employee.mustChangePassword ? "初期パスワードのまま" : "設定済み";

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">アカウント</h2>
      {children}
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-muted">状態</dt>
        <dd>
          {status}
          {locked && <span className="ml-2 font-bold text-danger">⚠ ロック中（{formatTime(locked)}まで）</span>}
        </dd>
        <dt className="text-ink-muted">最終ログイン</dt>
        <dd className="tabular-nums">{employee.lastLoginAt ? formatDateTime(employee.lastLoginAt) : "なし"}</dd>
      </dl>

      <AccountActionButtons
        employeeId={employee.id}
        name={name}
        hasLoginId={!!employee.loginId}
        hasEmail={!!employee.email}
        isActive={employee.isActive}
      />

      {shown && (
        <div className="rounded-lg border border-warning-line bg-warning-soft p-4 text-sm text-warning">
          <p className="font-bold">発行したパスワード（この画面を閉じると消えます）</p>
          <p className="mt-2 text-ink tabular-nums">
            ログインID: <span className="font-bold">{shown.loginId}</span>　パスワード:{" "}
            <span className="font-bold">{shown.password}</span>
          </p>
        </div>
      )}
    </section>
  );
}
