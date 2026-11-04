// 従業員テーブル(employees)のうち、ログイン関係の列(CMN-01 01 6章)の読み書き。
// パスワードの暗号(password_hash)を含むので、この型をそのまま画面(クライアント)へ渡さないこと。
import { query } from "@/utils/db";
import { LOCK_MINUTES, MAX_FAILED_LOGINS } from "@/utils/accountRules";
import { isRole, type Role } from "@/utils/permissions";

export type EmployeeAccount = {
  id: string;
  lastName: string;
  firstName: string;
  email: string | null;
  loginId: string | null;
  passwordHash: string | null;
  roles: Role[];
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  isActive: boolean;
};

type Row = {
  id: string;
  last_name: string;
  first_name: string;
  email: string | null;
  login_id: string | null;
  password_hash: string | null;
  roles: string[];
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  password_changed_at: Date | null;
  last_login_at: Date | null;
  is_active: boolean;
};

const toAccount = (row: Row): EmployeeAccount => ({
  id: row.id,
  lastName: row.last_name,
  firstName: row.first_name,
  email: row.email?.trim() || null,
  loginId: row.login_id,
  passwordHash: row.password_hash,
  roles: row.roles.filter(isRole),
  mustChangePassword: row.must_change_password,
  failedLoginCount: row.failed_login_count,
  lockedUntil: row.locked_until,
  passwordChangedAt: row.password_changed_at,
  lastLoginAt: row.last_login_at,
  isActive: row.is_active,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const findAccountById = async (id: string): Promise<EmployeeAccount | null> => {
  // uuid の形でない値でDBがエラーにならないよう、先に弾く
  if (!UUID_PATTERN.test(id)) return null;
  const rows = await query(
    (sql) => sql<Row[]>`
      select id, last_name, first_name, email, login_id, password_hash, roles, must_change_password,
             failed_login_count, locked_until, password_changed_at, last_login_at, is_active
      from employees where id = ${id}`
  );
  return rows[0] ? toAccount(rows[0]) : null;
};

// ログインIDは小文字にそろえて渡す(EV-02)
export const findAccountByLoginId = async (loginId: string): Promise<EmployeeAccount | null> => {
  const rows = await query(
    (sql) => sql<Row[]>`
      select id, last_name, first_name, email, login_id, password_hash, roles, must_change_password,
             failed_login_count, locked_until, password_changed_at, last_login_at, is_active
      from employees where lower(login_id) = ${loginId}`
  );
  return rows[0] ? toAccount(rows[0]) : null;
};

// EV-02 手順6: 失敗回数を1増やし、5回目なら15分ロックする(同時に押されても数え漏れないよう、DBの中で足す)
export const recordLoginFailure = async (id: string, now: Date): Promise<void> => {
  const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000);
  await query(
    (sql) => sql`
      update employees set
        failed_login_count = failed_login_count + 1,
        locked_until = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS} then ${lockedUntil} else locked_until end
      where id = ${id}`
  );
};

// EV-02 手順7: 失敗回数を0、ロックを解除、最終ログインを今にする
export const recordLoginSuccess = async (id: string, now: Date): Promise<void> => {
  await query(
    (sql) => sql`
      update employees set failed_login_count = 0, locked_until = null, last_login_at = ${now}
      where id = ${id}`
  );
};

// パスワードを保存する(EV-05・EV-07・EV-08)。password_changed_at を now にするので、
// now より前に作ったログイン状態と再設定リンクは使えなくなる(CH-08・CH-11)。
// resetLock: 失敗回数を0にしてロックを解く(EV-07・EV-08)。
export const savePassword = async ({
  id,
  passwordHash,
  mustChangePassword,
  resetLock,
  now,
  updatedBy,
}: {
  id: string;
  passwordHash: string;
  mustChangePassword: boolean;
  resetLock: boolean;
  now: Date;
  updatedBy: string;
}): Promise<void> => {
  await query((sql) =>
    resetLock
      ? sql`
          update employees set
            password_hash = ${passwordHash}, must_change_password = ${mustChangePassword},
            failed_login_count = 0, locked_until = null, password_changed_at = ${now}, updated_by = ${updatedBy}
          where id = ${id}`
      : sql`
          update employees set
            password_hash = ${passwordHash}, must_change_password = ${mustChangePassword},
            password_changed_at = ${now}, updated_by = ${updatedBy}
          where id = ${id}`
  );
};
