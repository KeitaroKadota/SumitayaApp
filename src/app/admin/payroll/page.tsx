// G01 給与CSV(集計・締め・出力)と G02 締めの確認・G03 締めの解除(モーダル)。E-03 03 の EV-01・EV-03〜EV-06。機能キー payroll。
// 締め済みの期間は保存した集計(snapshot)から、締め前・解除済みの期間は今の勤怠から集計を出す。
import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { SEVERITY_LABELS } from "@/utils/attendance";
import { formatDateShort, formatDateTime, formatDuration } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { payrollPeriodOf, shiftPayrollPeriod, type PayrollPeriod } from "@/utils/payrollPeriod";
import { PAYROLL_FIRST_MONTH } from "@/utils/payrollRules";
import {
  countOpenAlertsBySeverity,
  getPayrollExport,
  hasAttendanceIn,
  listOpenReviewAlerts,
  loadPayrollMasters,
  loadPayrollSummary,
  type PayrollExport,
} from "@/utils/payrollServer";
import { snapshotHash, type PayrollRow, type PayrollSnapshot } from "@/utils/payrollSummary";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { LinkButton } from "@/components/LinkButton";
import { Modal } from "@/components/Modal";
import { PeriodNav } from "@/components/PeriodNav";
import { buttonClassName } from "@/components/Button";
import { closePayrollAction, prepareCloseAction, reopenPayrollAction } from "./actions";
import { ClosePayrollForm, PrepareCloseForm, ReopenPayrollForm } from "./PayrollForms";
import { parsePayrollMonth, payrollUrl, periodLabel, periodNotEndedMessage } from "./payrollView";

const DONE_MESSAGES: Record<string, string> = {
  closed: "締めました。",
  reopened: "締めを解除しました。直したあと、もう一度締めてください。",
};

const navLabel = (p: PayrollPeriod) => `${Number(p.month.slice(5))}月`;
const alertsUrl = (month: string, severity: string) => `/admin/attendance/alerts?status=open&month=${month}&severity=${severity}`;
const time = (minutes: number) => formatDuration(minutes, "table");
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// CH-06 保存した集計が締めたときと同じか。同じなら集計を返す
const verifiedSnapshot = (row: PayrollExport): PayrollSnapshot | null => {
  if (snapshotHash(row.snapshot) !== row.snapshotHash) return null;
  const snapshot = row.snapshot as PayrollSnapshot;
  return Array.isArray(snapshot?.rows) ? snapshot : null;
};

function SummaryTable({ rows }: { rows: PayrollRow[] }) {
  if (rows.length === 0) return <EmptyState message="集計の対象の従業員はいません。" />;
  const th = "border-b border-line px-3 py-2 whitespace-nowrap";
  const num = "border-b border-line px-3 py-2 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-canvas text-left">
          <tr>
            <th className={th}>社員番号</th>
            <th className={th}>氏名</th>
            <th className={th}>所属</th>
            <th className={`${th} text-right`}>出勤</th>
            <th className={`${th} text-right`}>休出</th>
            <th className={`${th} text-right`}>有給</th>
            <th className={`${th} text-right`}>欠勤</th>
            <th className={`${th} text-right`}>総労働</th>
            <th className={`${th} text-right`}>時間外</th>
            <th className={`${th} text-right`}>深夜</th>
            <th className={`${th} text-right`}>遅刻</th>
            <th className={th}>備考</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className="align-top">
              <td className="border-b border-line px-3 py-2 tabular-nums">{r.employeeCode || "—"}</td>
              <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.name}</td>
              <td className="border-b border-line px-3 py-2 whitespace-nowrap">{r.departmentLabel}</td>
              <td className={num}>{r.workDays}</td>
              <td className={num}>{r.holidayWorkDays}</td>
              <td className={num}>{days(r.paidLeaveDays)}</td>
              <td className={num}>{r.absenceDays}</td>
              <td className={num}>{time(r.workedMinutes)}</td>
              <td className={num}>{time(r.overtimeMinutes)}</td>
              <td className={num}>{time(r.nightMinutes)}</td>
              <td className={num}>{r.lateCount > 0 ? `${r.lateCount}回` : "-"}</td>
              <td className="border-b border-line px-3 py-2 text-xs break-words">
                {r.note
                  .split("、")
                  .filter(Boolean)
                  .map((part) => (
                    <span key={part} className={`block ${part.startsWith("未確定") ? "font-bold text-danger" : ""}`}>
                      {part}
                    </span>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PayrollPage({ searchParams }: PageProps<"/admin/payroll">) {
  const params = await searchParams;
  const today = todayJST();
  // EV-01 手順1 CH-01
  const period = parsePayrollMonth(params.month, today);
  await requireAccess("payroll", payrollUrl(period.month));

  // 手順2
  const row = await getPayrollExport(period.from);
  const closed = row?.status === "closed";
  const prev = shiftPayrollPeriod(period, -1);
  const next = shiftPayrollPeriod(period, 1);
  const current = payrollPeriodOf(today);
  const done = typeof params.done === "string" ? DONE_MESSAGES[params.done] : undefined;

  // 手順3 締め済みは保存した集計から。手順4 締め前・解除済みは今の集計
  let rows: PayrollRow[] = [];
  let broken = false;
  let counts = { fix: 0, legal: 0, info: 0 };
  let blocker: string | null = null;
  let nextClosed = false;
  if (closed && row) {
    const snapshot = verifiedSnapshot(row);
    if (snapshot) rows = snapshot.rows;
    else broken = true;
    nextClosed = (await getPayrollExport(next.from))?.status === "closed";
  } else {
    const masters = await loadPayrollMasters(period);
    rows = (await loadPayrollSummary(period, today, masters)).rows;
    counts = await countOpenAlertsBySeverity(period);
    // CH-02・CH-05(押せないときの理由。締めるときにサーバーでもう一度確かめる)
    blocker = periodNotEndedMessage(period, today);
    if (!blocker && (await hasAttendanceIn(prev)) && (await getPayrollExport(prev.from))?.status !== "closed") {
      blocker = `先に ${periodLabel(prev)} を締めてください。`;
    }
  }
  const noCode = rows.filter((r) => !r.employeeCode).map((r) => r.name);

  // G02・G03(モーダル)
  const showClose = params.close === "1" && !closed;
  const showReopen = params.reopen === "1" && closed && row !== null;
  const reviewAlerts = showClose ? await listOpenReviewAlerts(period) : [];

  const statusBadge = closed ? (
    <Badge tone="success">締め済み</Badge>
  ) : row?.status === "reopened" ? (
    <Badge tone="warning">解除済み（締め前）</Badge>
  ) : (
    <Badge tone="neutral">締め前</Badge>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">給与CSV</h1>
      <PeriodNav
        label={`${periodLabel(period)}（${formatDateShort(period.from)}〜${formatDateShort(period.to)}）`}
        prev={prev.month >= PAYROLL_FIRST_MONTH ? { href: payrollUrl(prev.month), label: navLabel(prev) } : null}
        next={next.from <= current.from ? { href: payrollUrl(next.month), label: navLabel(next) } : null}
      />
      {done && <Alert tone="success">{done}</Alert>}

      <div className="flex flex-col gap-1 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-bold">状態</span>
          {statusBadge}
          {closed && row && (
            <span className="tabular-nums">
              {formatDateTime(row.closedAt)} {row.closedByName ?? "—"}（{row.closeCount}回目）
            </span>
          )}
          {!closed && row?.status === "reopened" && row.reopenedAt && (
            <span className="break-words">
              {formatDateShort(row.reopenedAt)} 解除：{row.reopenReason}
            </span>
          )}
        </p>
        {closed && row && (
          <p className="tabular-nums">
            出力 {row.exportCount}回
            {row.lastExportedAt && `（最後 ${formatDateTime(row.lastExportedAt)} ${row.lastExportedByName ?? "—"}）`}
          </p>
        )}
      </div>

      {!closed && (
        <section aria-label="締める前の確認" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 text-sm">
          <h2 className="font-bold">締める前の確認</h2>
          <p className={counts.fix > 0 ? "text-danger" : ""}>
            {counts.fix > 0 ? "✕" : "✓"} {SEVERITY_LABELS.fix}の異常 {counts.fix}件
            {counts.fix > 0 && "（直さないと締められません）"}
            {counts.fix > 0 && (
              <Link href={alertsUrl(period.month, "fix")} className="ml-2 font-bold text-primary hover:underline">
                一覧を見る ›
              </Link>
            )}
          </p>
          <p className={counts.legal + counts.info > 0 ? "text-warning" : ""}>
            {counts.legal + counts.info > 0 ? "⚠" : "✓"} 法令・確認の異常 {counts.legal + counts.info}件
            {counts.legal + counts.info > 0 && "（確認してから締めます）"}
            {counts.legal > 0 && (
              <Link href={alertsUrl(period.month, "legal")} className="ml-2 font-bold text-primary hover:underline">
                法令の一覧 ›
              </Link>
            )}
            {counts.info > 0 && (
              <Link href={alertsUrl(period.month, "info")} className="ml-2 font-bold text-primary hover:underline">
                確認の一覧 ›
              </Link>
            )}
          </p>
          <p>
            {periodNotEndedMessage(period, today) ? (
              <>⚠ {periodNotEndedMessage(period, today)}</>
            ) : (
              <>✓ 期間が終わっています</>
            )}
          </p>
        </section>
      )}

      {noCode.length > 0 && (
        <Alert tone="warning">社員番号が無い従業員がいます（{noCode.join("、")}）。従業員マスタで登録してください。</Alert>
      )}

      <section aria-label="集計" className="flex flex-col gap-2">
        <h2 className="font-bold">集計{closed && <span className="ml-2 text-sm font-normal text-ink-muted">締めたときの内容</span>}</h2>
        {broken ? (
          <Alert tone="error">保存した集計が壊れています。開発者に連絡してください。</Alert>
        ) : (
          <SummaryTable rows={rows} />
        )}
        <p className="text-sm text-ink-muted">※休出・休日出勤は「会社の休業日（定休日など）の勤務」です。</p>
        {!closed && <p className="text-sm text-ink-muted">※この集計は締めるまで変わることがあります。</p>}
        <p className="text-sm text-ink-muted">※全部の列（遅刻・早退の時間、休憩など）はCSVで確かめてください。</p>
      </section>

      {closed ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            {nextClosed ? (
              <>
                <span className={buttonClassName("secondary", "md", "pointer-events-none opacity-50")} aria-disabled="true">
                  締めを解除する
                </span>
                <span className="text-sm text-ink-muted">先に {periodLabel(next)} の締めを解除してください。</span>
              </>
            ) : (
              <LinkButton href={payrollUrl(period.month, "&reopen=1")}>締めを解除する</LinkButton>
            )}
          </div>
          {!broken && (
            // EV-05 POST で送る(リンクの先読みで出力の回数が増えないように)。ファイルはその場で作って返す
            <form method="post" action="/admin/payroll/export">
              <input type="hidden" name="period_start" value={period.from} />
              <button type="submit" className={buttonClassName("primary")}>
                CSVを出力する
              </button>
            </form>
          )}
        </div>
      ) : (
        <PrepareCloseForm action={prepareCloseAction.bind(null, period.month)} blocker={blocker} />
      )}

      {showClose && (
        <Modal title={`${periodLabel(period)}を締める`} closeHref={payrollUrl(period.month)} size="md">
          <div className="flex flex-col gap-3 text-sm">
            <p>締める前に、最新の状態でチェックし直しました。</p>
            <p className={counts.fix > 0 ? "font-bold text-danger" : ""}>✕ 要修正の異常 {counts.fix}件</p>
            {counts.fix > 0 && (
              <Alert tone="error">
                要修正の異常を直してから締めてください。
                <Link href={alertsUrl(period.month, "fix")} className="ml-2 font-bold underline">
                  一覧を見る ›
                </Link>
              </Alert>
            )}
            <p>⚠ 法令・確認の未対応 {reviewAlerts.length}件</p>
            {reviewAlerts.length > 0 && (
              <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto pl-3">
                {reviewAlerts.map((a, i) => (
                  <li key={`${a.workDate}-${a.kind}-${i}`} className="break-words">
                    ・{a.employeeName} {formatDateShort(a.workDate)} {a.message}
                  </li>
                ))}
              </ul>
            )}
            <ClosePayrollForm
              action={closePayrollAction.bind(null, period.month)}
              periodStart={period.from}
              needConfirm={reviewAlerts.length > 0}
              blocked={counts.fix > 0}
              cancelHref={payrollUrl(period.month)}
            />
          </div>
        </Modal>
      )}

      {showReopen && row && (
        <Modal title={`${periodLabel(period)}の締めを解除する`} closeHref={payrollUrl(period.month)} size="md">
          <div className="flex flex-col gap-3 text-sm">
            {row.exportCount > 0 && (
              <Alert tone="warning">
                このCSVはすでに{row.exportCount}回出力されています。直したあとに出力し直し、社労士さんに差し替えをお伝えください。
              </Alert>
            )}
            {nextClosed && <Alert tone="error">先に {periodLabel(next)} の締めを解除してください。</Alert>}
            <ReopenPayrollForm action={reopenPayrollAction.bind(null, period.month)} cancelHref={payrollUrl(period.month)} />
          </div>
        </Modal>
      )}
    </div>
  );
}

