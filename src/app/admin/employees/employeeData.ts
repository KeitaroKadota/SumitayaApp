// 従業員マスタ(CMN-02 G01〜G03)の読み書き。password_hash は読まない。
// 呼ぶ側のページ・操作で requireAccess("employees", …) を済ませておくこと。
import { query } from "@/utils/db";
import { isRole, type Role } from "@/utils/permissions";
import type { Department, EmploymentType } from "@/utils/masterRules";

export type WorkLocation = { id: string; name: string; kind: "store" | "factory"; isActive: boolean };

// 打刻の場所(E-01 の work_locations)。主な勤務場所の選択肢に使う
export const listWorkLocations = async (): Promise<WorkLocation[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; name: string; kind: "store" | "factory"; is_active: boolean }[]>`
      select id, name, kind, is_active from work_locations order by sort_order, name`
  );
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, isActive: r.is_active }));
};

// EV-01 手順3: ログインの状態
export type LoginStatus = "none" | "locked" | "initial" | "set";
export const LOGIN_STATUS_LABELS: Record<LoginStatus, string> = {
  none: "未発行",
  locked: "ロック中",
  initial: "初期PWのまま",
  set: "設定済み",
};

export type EmployeeListItem = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
  department: Department;
  employmentType: EmploymentType;
  roles: Role[];
  usesTimecard: boolean;
  homeLocationName: string | null;
  loginStatus: LoginStatus;
  lineLinked: boolean;
  isActive: boolean;
};

// EV-01: 在籍中が先、その中は社員番号 → ふりがな
export const listEmployeesForAdmin = async (includeRetired: boolean): Promise<EmployeeListItem[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        employee_code: string;
        last_name: string;
        first_name: string;
        department: Department;
        employment_type: EmploymentType;
        roles: string[];
        uses_timecard: boolean;
        location_name: string | null;
        has_login_id: boolean;
        has_password: boolean;
        locked: boolean;
        must_change_password: boolean;
        line_linked: boolean;
        is_active: boolean;
      }[]
    >`
      select e.id, e.employee_code, e.last_name, e.first_name, e.department, e.employment_type, e.roles,
             e.uses_timecard, w.name as location_name,
             e.login_id is not null as has_login_id, e.password_hash is not null as has_password,
             coalesce(e.locked_until > now(), false) as locked, e.must_change_password,
             e.line_user_id is not null as line_linked, e.is_active
      from employees e left join work_locations w on w.id = e.home_location_id
      ${includeRetired ? sql`` : sql`where e.is_active`}
      order by e.is_active desc, e.employee_code, e.last_name_kana nulls last, e.first_name_kana nulls last`
  );
  return rows.map((r) => ({
    id: r.id,
    employeeCode: r.employee_code,
    lastName: r.last_name,
    firstName: r.first_name,
    department: r.department,
    employmentType: r.employment_type,
    roles: r.roles.filter(isRole),
    usesTimecard: r.uses_timecard,
    homeLocationName: r.location_name,
    loginStatus: !r.has_login_id || !r.has_password ? "none" : r.locked ? "locked" : r.must_change_password ? "initial" : "set",
    lineLinked: r.line_linked,
    isActive: r.is_active,
  }));
};

export type EmployeeDetail = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
  lastNameKana: string | null;
  firstNameKana: string | null;
  department: Department;
  employmentType: EmploymentType;
  email: string | null;
  hiredOn: string | null;
  retiredOn: string | null;
  usesTimecard: boolean;
  homeLocationId: string | null;
  note: string | null;
  loginId: string | null;
  roles: Role[];
  hasPassword: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  isActive: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

export const getEmployeeDetail = async (id: string): Promise<EmployeeDetail | null> => {
  if (!isUuid(id)) return null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        employee_code: string;
        last_name: string;
        first_name: string;
        last_name_kana: string | null;
        first_name_kana: string | null;
        department: Department;
        employment_type: EmploymentType;
        email: string | null;
        hired_on: string | null;
        retired_on: string | null;
        uses_timecard: boolean;
        home_location_id: string | null;
        note: string | null;
        login_id: string | null;
        roles: string[];
        has_password: boolean;
        must_change_password: boolean;
        locked_until: Date | null;
        last_login_at: Date | null;
        is_active: boolean;
      }[]
    >`
      select id, employee_code, last_name, first_name, last_name_kana, first_name_kana, department, employment_type,
             email, to_char(hired_on, 'YYYY-MM-DD') as hired_on, to_char(retired_on, 'YYYY-MM-DD') as retired_on,
             uses_timecard, home_location_id, note, login_id, roles, password_hash is not null as has_password,
             must_change_password, locked_until, last_login_at, is_active
      from employees where id = ${id}`
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    employeeCode: r.employee_code,
    lastName: r.last_name,
    firstName: r.first_name,
    lastNameKana: r.last_name_kana,
    firstNameKana: r.first_name_kana,
    department: r.department,
    employmentType: r.employment_type,
    email: r.email,
    hiredOn: r.hired_on,
    retiredOn: r.retired_on,
    usesTimecard: r.uses_timecard,
    homeLocationId: r.home_location_id,
    note: r.note,
    loginId: r.login_id,
    roles: r.roles.filter(isRole),
    hasPassword: r.has_password,
    mustChangePassword: r.must_change_password,
    lockedUntil: r.locked_until,
    lastLoginAt: r.last_login_at,
    isActive: r.is_active,
  };
};

// 保存する列(EV-02 手順5・EV-04 手順4)
export type EmployeeInput = {
  employeeCode: string;
  lastName: string;
  firstName: string;
  lastNameKana: string | null;
  firstNameKana: string | null;
  department: Department;
  employmentType: EmploymentType;
  email: string | null;
  hiredOn: string | null;
  usesTimecard: boolean;
  homeLocationId: string | null;
  note: string | null;
  loginId: string | null;
  roles: Role[];
};

// CH-03 社員番号の重複(退職者を含む)
export const employeeCodeTaken = async (code: string, excludeId: string | null): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from employees where employee_code = ${code} ${excludeId ? sql`and id <> ${excludeId}` : sql``} limit 1`
  );
  return rows.length > 0;
};

// CMN-01 CH-04 ログインIDの重複(退職者を含む。大文字・小文字を区別しない)
export const loginIdTaken = async (loginId: string, excludeId: string | null): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from employees where lower(login_id) = ${loginId} ${excludeId ? sql`and id <> ${excludeId}` : sql``} limit 1`
  );
  return rows.length > 0;
};

// CH-04 同じメールアドレスのほかの従業員がいるか(保存は止めない。注意を出す)
export const emailUsedByOthers = async (email: string, excludeId: string | null): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from employees where lower(email) = lower(${email}) ${excludeId ? sql`and id <> ${excludeId}` : sql``} limit 1`
  );
  return rows.length > 0;
};

// CMN-01 CH-14: この従業員を除いた「在籍中で、社長の区分を持ち、ログインIDがある従業員」の人数
export const countOtherActivePresidents = async (excludeId: string): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ n: number }[]>`
      select count(*)::int as n from employees
      where is_active and 'president' = any(roles) and login_id is not null and id <> ${excludeId}`
  );
  return rows[0]?.n ?? 0;
};

// CH-30 主な勤務場所が使用中の場所か
export const isActiveWorkLocation = async (id: string): Promise<boolean> => {
  if (!isUuid(id)) return false;
  const rows = await query((sql) => sql<{ id: string }[]>`select id from work_locations where id = ${id} and is_active`);
  return rows.length > 0;
};

// EV-02 手順5
export const insertEmployee = async (input: EmployeeInput, by: string): Promise<string> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      insert into employees (
        employee_code, last_name, first_name, last_name_kana, first_name_kana, department, employment_type, email,
        hired_on, uses_timecard, home_location_id, note, login_id, roles, is_active, must_change_password,
        created_by, updated_by
      ) values (
        ${input.employeeCode}, ${input.lastName}, ${input.firstName}, ${input.lastNameKana}, ${input.firstNameKana},
        ${input.department}, ${input.employmentType}, ${input.email}, ${input.hiredOn}, ${input.usesTimecard},
        ${input.homeLocationId}, ${input.note}, ${input.loginId}, ${input.roles}::text[], true, true, ${by}, ${by}
      ) returning id`
  );
  return rows[0].id;
};

// EV-04 手順4: 基本情報・ログインID・権限を1回の UPDATE で保存。パスワードはそのまま
export const updateEmployee = async (id: string, input: EmployeeInput, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update employees set
        employee_code = ${input.employeeCode}, last_name = ${input.lastName}, first_name = ${input.firstName},
        last_name_kana = ${input.lastNameKana}, first_name_kana = ${input.firstNameKana},
        department = ${input.department}, employment_type = ${input.employmentType}, email = ${input.email},
        hired_on = ${input.hiredOn}, uses_timecard = ${input.usesTimecard}, home_location_id = ${input.homeLocationId},
        note = ${input.note}, login_id = ${input.loginId}, roles = ${input.roles}::text[], updated_by = ${by}
      where id = ${id}`
  );
};

// EV-05 手順4: 退職(LINE の結び付けは消さない)
export const retireEmployee = async (id: string, retiredOn: string, by: string): Promise<void> => {
  await query(
    (sql) => sql`update employees set is_active = false, retired_on = ${retiredOn}, updated_by = ${by} where id = ${id}`
  );
};

// EV-06 手順2: 在籍に戻す(パスワードは変えない)
export const reinstateEmployee = async (id: string, by: string): Promise<void> => {
  await query(
    (sql) => sql`update employees set is_active = true, retired_on = null, updated_by = ${by} where id = ${id}`
  );
};
