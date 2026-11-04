// G05 勤怠の異常の一覧(E-02 03 の EV-10)。機能キー attendance_admin。
// 行を押すと G02(その人・その日)を開く。月の時間外の行は G01 のその人の行へ移る。
import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { OVERTIME_ALERT_KINDS, SEVERITY_LABELS, type AlertSeverity } from "@/utils/attendance";
import {
  ALERT_STATUS_LABELS,
  countAlerts,
  isAlertStatus,
  listAlerts,
  listAttendanceEmployees,
  type AlertFilter,
} from "@/utils/attendanceServer";
import { formatDateShort } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { payrollPeriodOf, payrollPeriodOfMonth, shiftPayrollPeriod } from "@/utils/payrollPeriod";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { SEVERITY_TONES, attendanceUrl, isUuid } from "../attendanceView";

const PAGE_SIZE = 50;
const MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;
// 月の選択肢(今の期間から前の12か月)
const MONTH_OPTIONS = 12;

const isSeverity = (v: string): v is AlertSeverity => v === "fix" || v === "legal" || v === "info";

export default async function AttendanceAlertsPage({ searchParams }: PageProps<"/admin/attendance/alerts">) {
  const params = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const today = todayJST();
  const current = payrollPeriodOf(today);

  // 手順1 絞り込み(初期値は「未対応」「すべて」「すべて」「今の期間」)
  const statusParam = str(params.status) || "open";
  const status = isAlertStatus(statusParam) ? statusParam : null;
  const severity = isSeverity(str(params.severity)) ? (str(params.severity) as AlertSeverity) : null;
  const employeeId = isUuid(str(params.employee)) ? str(params.employee) : null;
  const month = MONTH_PATTERN.test(str(params.month)) ? str(params.month) : current.month;
  const period = payrollPeriodOfMonth(month);
  const page = Math.max(1, Number.parseInt(str(params.page), 10) || 1);

  const query = new URLSearchParams({ status: status ?? "all", month });
  if (severity) query.set("severity", severity);
  if (employeeId) query.set("employee", employeeId);
  await requireAccess("attendance_admin", `/admin/attendance/alerts?${query.toString()}`);

  // 手順2
  const filter: AlertFilter = { status, severity, employeeId, from: period.from, to: period.to };
  const total = await countAlerts(filter);
  const alerts = await listAlerts(filter, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const employees = await listAttendanceEmployees(period.from, period.to);

  const months: string[] = [];
  for (let i = 0, p = current; i < MONTH_OPTIONS; i++, p = shiftPayrollPeriod(p, -1)) months.push(p.month);
  if (!months.includes(month)) months.push(month);
  const hrefOf = (n: number) => {
    const q = new URLSearchParams(query);
    q.set("page", String(n));
    return `/admin/attendance/alerts?${q.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">勤怠の異常</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-bold">
          状態
          <AutoSubmitSelect name="status" defaultValue={status ?? "all"} className="w-36">
            <option value="open">未対応</option>
            <option value="resolved">解決</option>
            <option value="dismissed">確認済み</option>
            <option value="all">すべて</option>
          </AutoSubmitSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          重さ
          <AutoSubmitSelect name="severity" defaultValue={severity ?? ""} className="w-36">
            <option value="">すべての重さ</option>
            <option value="fix">要修正</option>
            <option value="legal">法令</option>
            <option value="info">確認</option>
          </AutoSubmitSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          従業員
          <AutoSubmitSelect name="employee" defaultValue={employeeId ?? ""} className="w-44">
            <option value="">すべての従業員</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.lastName} {e.firstName}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          月
          <AutoSubmitSelect name="month" defaultValue={month} className="w-40">
            {months.map((m) => (
              <option key={m} value={m}>
                {m.slice(0, 4)}年{Number(m.slice(5))}月
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
      </form>

      {alerts.length === 0 ? (
        <EmptyState message={status === "open" ? "未対応の異常はまだありません。" : "該当する異常はありません。"} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">重さ</th>
                  <th className="px-3 py-2">日付</th>
                  <th className="px-3 py-2">従業員</th>
                  <th className="px-3 py-2">内容</th>
                  <th className="px-3 py-2">状態</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => {
                  const overtime = OVERTIME_ALERT_KINDS.includes(a.kind);
                  const alertMonth = payrollPeriodOf(a.workDate).month;
                  const href = overtime
                    ? `${attendanceUrl(alertMonth)}#emp-${a.employeeId}`
                    : attendanceUrl(alertMonth, `&edit=${a.employeeId}:${a.workDate}`);
                  return (
                    <tr key={a.id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2">
                        <Badge tone={SEVERITY_TONES[a.severity]}>{SEVERITY_LABELS[a.severity]}</Badge>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {overtime ? `${Number(alertMonth.slice(5))}月` : formatDateShort(a.workDate)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{a.employeeName}</td>
                      <td className="px-3 py-2">
                        <Link href={href} className="font-bold text-primary break-words hover:underline">
                          {a.message}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" title={a.status === "dismissed" ? (a.resolutionNote ?? undefined) : undefined}>
                        {ALERT_STATUS_LABELS[a.status]}
                        {a.status === "dismissed" && a.resolutionNote && (
                          <span className="block max-w-48 truncate text-xs text-ink-muted">{a.resolutionNote}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
    </div>
  );
}
