// タスクの種類の表と、タスクの表示の決まり(CMN-03 01 7.2・4.1、02 の G01〜G04)。
// 種類は DB の CHECK ではなくこの表で管理する。機能を作るたびに1行足す(00_共通設計 1章「状態」の例外)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。
import { FEATURES, ROLE_LABELS, type FeatureKey, type Role } from "@/utils/permissions";

export type TaskTypeInfo = {
  // 名前(画面・LINE の文に出す)
  label: string;
  // 発行元の機能ID
  feature: string;
  // 担当(本人)が手で完了にできるか。false の種類は、元の機能が問題の解決を確かめて自動で閉じる
  manualComplete: boolean;
};

// 担当は各機能が createTask で渡す(この表では持たない。各機能の設計書の値は CMN-03 01 7.2 を参照)。
// 【仮】「手で完了にできるか」が各機能の設計書で決まっていない種類は、仮の値にしている(00_仮決め一覧 CMN03-仮-14)
export const TASK_TYPES = {
  // E-02 勤怠の確認。管理者あて(attendance_alert)と本人あて(_self)。異常が直る・確認済みになると E-02 が自動で完了にする(E-02 01 7章)
  attendance_alert: { label: "勤怠の確認", feature: "E-02", manualComplete: false },
  attendance_alert_self: { label: "勤怠の確認", feature: "E-02", manualComplete: false },
  // E-04 受け取った請求書の確認。「確認して支払予定にする」「取り消す」で E-04 が自動で完了にする(E-04 03 の 0.4)
  payable_review: { label: "受け取った請求書の確認", feature: "E-04", manualComplete: false },
  // E-07 経費。承認・差し戻し、申請し直す・取り下げで閉じる
  expense_approve: { label: "経費の承認", feature: "E-07", manualComplete: false },
  expense_returned: { label: "経費の差し戻し", feature: "E-07", manualComplete: false },
  // B-04 今週の棚卸(【仮】B-04 で決める)
  stocktake: { label: "今週の棚卸", feature: "B-04", manualComplete: true },
  // C-02 検収の確認(C-02 の 01 の 7章・9章 #8 の仮の値)
  receiving_check: { label: "検収の確認", feature: "C-02", manualComplete: false },
  // D-05 見込み顧客のフォロー(【仮】D-05 で決める)
  lead_follow: { label: "見込み顧客のフォロー", feature: "D-05", manualComplete: true },
} as const satisfies Record<string, TaskTypeInfo>;

export type TaskType = keyof typeof TASK_TYPES;

export const isTaskType = (value: string): value is TaskType => Object.hasOwn(TASK_TYPES, value);

// 種類の名前と、手で完了にできるか。表に無い種類は名前に種類の値をそのまま出し、手で完了にできるものとして扱う(EV-01 手順3)
export const taskTypeInfo = (type: string): TaskTypeInfo =>
  isTaskType(type) ? TASK_TYPES[type] : { label: type, feature: "", manualComplete: true };

// 「勤怠の確認（E-02）」の形
export const taskTypeLabel = (type: string): string => {
  const info = taskTypeInfo(type);
  return info.feature ? `${info.label}（${info.feature}）` : info.label;
};

export const TASK_STATUSES = ["open", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: "未完了", done: "完了", cancelled: "取消" };
export const isTaskStatus = (value: string): value is TaskStatus => (TASK_STATUSES as readonly string[]).includes(value);

export const TASK_PRIORITIES = ["normal", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// 期限の分け方(EV-01 手順4): 期限切れ・今日まで・これから・期限なし。today は todayJST()
export type DueState = "overdue" | "today" | "future" | "none";
export const dueStateOf = (dueDate: string | null, today: string): DueState =>
  !dueDate ? "none" : dueDate < today ? "overdue" : dueDate === today ? "today" : "future";

// 長さの上限(CH-01)
export const TASK_TITLE_MAX = 100;
export const TASK_BODY_MAX = 2000;
export const TASK_NOTE_MAX = 500;

export const isFeatureKey = (value: string): value is FeatureKey => Object.hasOwn(FEATURES, value);

// 機能キーあての担当の名前(例: 「全員の勤怠チェック・シフトができる人」。02 の G01)
export const featureAssigneeLabel = (key: string): string =>
  isFeatureKey(key) ? `${FEATURES[key].label}ができる人` : `${key}ができる人`;

// 担当の表示。人あては「山田 太郎」、区分あては「店舗」、機能キーあては「〇〇ができる人」
export const assigneeLabel = (task: {
  assigneeName: string | null;
  assigneeRole: Role | null;
  assigneeFeatureKey: string | null;
}): string => {
  if (task.assigneeRole) return ROLE_LABELS[task.assigneeRole];
  if (task.assigneeFeatureKey) return featureAssigneeLabel(task.assigneeFeatureKey);
  return task.assigneeName ?? "—";
};
