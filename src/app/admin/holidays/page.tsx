import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort } from "@/utils/format";
import { yearHolidayCandidates } from "@/utils/holidays";
import { HOLIDAY_KINDS } from "@/utils/masterRules";
import { Alert } from "@/components/Alert";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { addHoliday, deleteHolidayAction, generateYearHolidays, saveHoliday } from "./actions";
import { existingDatesOfYear, listHolidays } from "./holidayData";
import { HolidayAddForm, HolidayEditButton } from "./HolidayForms";
import { holidaysUrl, MAX_YEAR, MIN_YEAR, parseYear } from "./holidayYear";

const navClass = "inline-flex min-h-11 items-center px-2 text-sm font-bold text-primary hover:underline";

// G11 祝日・休業日(CMN-02 EV-17〜EV-21)
export default async function HolidaysPage({ searchParams }: PageProps<"/admin/holidays">) {
  const params = await searchParams;
  const year = parseYear(params.year);
  await requireAccess("holidays", holidaysUrl(year));
  const monthParam = Number(params.month);
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : null;

  const [holidays, existing] = [await listHolidays(year, month), await existingDatesOfYear(year)];

  // 「この年の休日を作る」で作る件数(すでにある日は作らない。CH-28)。確認のダイアログに出す
  const candidates = yearHolidayCandidates(year).filter((c) => !existing.has(c.date));
  const nationalCount = candidates.filter((c) => c.kind === "national").length;
  const regularCount = candidates.filter((c) => c.kind === "regular").length;
  const generateConfirm = `${year}年の祝日 ${nationalCount} 日と定休日（水・木）${regularCount} 日を作ってよいですか？すでにある日は変えません。`;

  const created = typeof params.created === "string" ? params.created : null;
  const saved = params.saved === "1" ? "保存しました。" : params.saved === "deleted" ? "削除しました。" : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">祝日・休業日</h1>
        <nav aria-label="年の切り替え" className="flex items-center gap-3 tabular-nums">
          {year > MIN_YEAR && (
            <Link href={holidaysUrl(year - 1)} className={navClass}>
              ‹ {year - 1}年
            </Link>
          )}
          <span className="font-bold">{year}年</span>
          {year < MAX_YEAR && (
            <Link href={holidaysUrl(year + 1)} className={navClass}>
              {year + 1}年 ›
            </Link>
          )}
        </nav>
      </div>

      {created !== null && <Alert tone="success">{created}件を作りました。すでにあった日は変えていません。</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}

      <form action={generateYearHolidays.bind(null, year)} className="flex flex-wrap items-center gap-3">
        <ConfirmSubmitButton variant="primary" confirmMessage={generateConfirm} pendingText="作成中…" disabled={candidates.length === 0}>
          この年の休日を作る
        </ConfirmSubmitButton>
        <p className="text-sm text-ink-muted">
          {candidates.length === 0 ? "この年の祝日と定休日は、すべて作ってあります。" : "祝日と定休日（水・木）を一括で作ります。"}
        </p>
      </form>

      <HolidayAddForm action={addHoliday.bind(null, year)} />

      <form method="get" className="flex items-end gap-3">
        <input type="hidden" name="year" value={year} />
        <label htmlFor="month" className="flex flex-col gap-1 text-sm font-bold">
          月で絞り込む
          <AutoSubmitSelect id="month" name="month" defaultValue={month ? String(month) : ""} className="w-32">
            <option value="">すべて</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>
                {i + 1}月
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
      </form>

      {holidays.length === 0 ? (
        <EmptyState message={month ? "この月の休日はありません。" : "この年の休日はまだありません。"} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">日付</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2">店は</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => {
                // 休業日は「休」、祝日で営業する日は「祝」の文字を付ける(色だけにしない)
                const mark = h.isClosed ? "休" : h.kind === "national" ? "祝" : "";
                const dateLabel = formatDateShort(h.date);
                const auto = h.kind === "national" || h.kind === "regular";
                return (
                  <tr key={h.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 tabular-nums">
                      {dateLabel}
                      {mark && <span className="ml-1 font-bold">{mark}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {h.name}
                      {h.note && <span className="ml-2 text-xs text-ink-muted">{h.note}</span>}
                    </td>
                    <td className="px-3 py-2">{HOLIDAY_KINDS[h.kind]}</td>
                    <td className="px-3 py-2">{h.isClosed ? "休み" : "営業"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <HolidayEditButton label={dateLabel} holiday={h} action={saveHoliday.bind(null, h.id)} />
                        <form action={deleteHolidayAction.bind(null, h.id)}>
                          <ConfirmSubmitButton
                            variant="secondary"
                            pendingText="削除中…"
                            confirmMessage={
                              auto
                                ? "自動で作った日です。営業にするなら『変更する』をお使いください。削除してよいですか？"
                                : `${dateLabel}の「${h.name}」を削除してよいですか？`
                            }
                          >
                            削除する
                          </ConfirmSubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
