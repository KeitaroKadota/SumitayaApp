// 従業員の LINE の列(employees.line_user_id・line_display_name・line_linked_at)の読み書き(CMN-03 01 6.4)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireLogin / requireAccess を済ませている前提)。
import { query } from "@/utils/db";

export type LineLinkStatus = {
  linked: boolean;
  displayName: string | null;
  linkedAt: Date | null;
};

// EV-09 手順2: 結び付けの状態。従業員が見つからなければ null
export const getLineLinkStatus = async (employeeId: string): Promise<LineLinkStatus | null> => {
  const rows = await query(
    (sql) => sql<{ line_user_id: string | null; line_display_name: string | null; line_linked_at: Date | null }[]>`
      select line_user_id, line_display_name, line_linked_at from employees where id = ${employeeId}`
  );
  const r = rows[0];
  if (!r) return null;
  return { linked: r.line_user_id !== null, displayName: r.line_display_name, linkedAt: r.line_linked_at };
};

// CH-13: その LINE の ID が、本人以外の従業員(退職者を含む)に結び付いているか
export const lineUserIdUsedByOthers = async (lineUserId: string, employeeId: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from employees where line_user_id = ${lineUserId} and id <> ${employeeId} limit 1`
  );
  return rows.length > 0;
};

// EV-11 手順7: 本人の LINE の ID・表示名を保存する(重複の制約 employees_line_user_id_key に当たると例外)
export const saveLineLink = async ({
  employeeId,
  lineUserId,
  displayName,
}: {
  employeeId: string;
  lineUserId: string;
  displayName: string;
}): Promise<void> => {
  await query(
    (sql) => sql`
      update employees
      set line_user_id = ${lineUserId}, line_display_name = ${displayName}, line_linked_at = now(), updated_by = ${employeeId}
      where id = ${employeeId}`
  );
};

// EV-12・EV-14: 結び付けを解除する。updatedBy は操作した人
export const clearLineLink = async (employeeId: string, updatedBy: string): Promise<void> => {
  await query(
    (sql) => sql`
      update employees
      set line_user_id = null, line_display_name = null, line_linked_at = null, updated_by = ${updatedBy}
      where id = ${employeeId}`
  );
};
