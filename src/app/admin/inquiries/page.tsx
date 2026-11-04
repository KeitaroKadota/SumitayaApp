import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatDuration, formatTime } from "@/utils/format";
import { getAiUsage } from "@/utils/gemini";
import { getCalendar } from "@/utils/holidays";
import {
  INQUIRY_CATEGORIES,
  INQUIRY_CATEGORY_SHORT,
  INQUIRY_CHANNELS,
  INQUIRY_STATUSES,
  REPLY_TARGET_MINUTES,
  isInquiryCategory,
  isInquiryChannel,
  isInquiryStatus,
} from "@/utils/inquiryRules";
import { UUID_PATTERN } from "@/utils/inquiries";
import { listActiveEmployees } from "@/utils/masters";
import { AiUsageNotice } from "@/components/AiUsageNotice";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { TextInput } from "@/components/TextInput";
import { PAGE_SIZE, listInquiries, type InquiryFilter } from "./inquiryData";
import { STATUS_TONES } from "./statusTone";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

// G01 問い合わせの一覧(D-01 EV-01)。初めは未対応・対応中・返事待ちを、受信の新しい順に50件ずつ
export default async function InquiriesPage({ searchParams }: PageProps<"/admin/inquiries">) {
  await requireAccess("inquiries", "/admin/inquiries");
  const params = await searchParams;

  // 手順1: 絞り込みの条件
  const statusParam = str(params.status);
  const categoryParam = str(params.category);
  const channelParam = str(params.channel);
  const assignedParam = str(params.assigned);
  const filter: InquiryFilter = {
    status: statusParam === "all" || isInquiryStatus(statusParam) ? statusParam : "open",
    category: categoryParam === "none" || isInquiryCategory(categoryParam) ? categoryParam : "",
    channel: isInquiryChannel(channelParam) ? channelParam : "",
    assignedTo: UUID_PATTERN.test(assignedParam) ? assignedParam : "",
    q: str(params.q).slice(0, 100),
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  // 手順2〜4
  const { total, items } = await listInquiries(filter, page);
  const staff = await listActiveEmployees({ featureKey: "inquiries" });
  const usage = await getAiUsage();
  const days = items.map((i) => i.receivedOn).sort();
  const calendar = days.length > 0 ? await getCalendar(days[0], days[days.length - 1]) : new Map();

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (filter.status !== "open") sp.set("status", filter.status);
    if (filter.category) sp.set("category", filter.category);
    if (filter.channel) sp.set("channel", filter.channel);
    if (filter.assignedTo) sp.set("assigned", filter.assignedTo);
    if (filter.q) sp.set("q", filter.q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/inquiries${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">問い合わせ</h1>
        {/* G03 CSV取り込みは、楽楽自動応対のCSVの見本が届いてから作る(01 の 7.2) */}
        <LinkButton href="/admin/inquiries/new" variant="primary">
          貼り付けて取り込む
        </LinkButton>
      </div>
      <AiUsageNotice usage={usage} />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="status" label="状態">
          <AutoSubmitSelect id="status" name="status" defaultValue={filter.status} className="w-52">
            <option value="open">未対応・対応中・返事待ち</option>
            <option value="all">すべて</option>
            {Object.entries(INQUIRY_STATUSES).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </Field>
        <Field id="category" label="種類">
          <AutoSubmitSelect id="category" name="category" defaultValue={filter.category} className="w-44">
            <option value="">すべて</option>
            <option value="none">未分類</option>
            {Object.entries(INQUIRY_CATEGORIES).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </Field>
        <Field id="channel" label="経路">
          <AutoSubmitSelect id="channel" name="channel" defaultValue={filter.channel} className="w-36">
            <option value="">すべて</option>
            {Object.entries(INQUIRY_CHANNELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </Field>
        <Field id="assigned" label="担当">
          <AutoSubmitSelect id="assigned" name="assigned" defaultValue={filter.assignedTo} className="w-36">
            <option value="">すべて</option>
            {staff.map((e) => (
              <option key={e.id} value={e.id}>
                {e.lastName} {e.firstName}
              </option>
            ))}
          </AutoSubmitSelect>
        </Field>
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={filter.q} placeholder="お客様名・メール・件名" className="w-64" />
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          絞り込む
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          message={filter.status === "open" && !filter.q ? "未対応の問い合わせはまだありません。" : "条件に合う問い合わせはありません。"}
          action={
            <LinkButton href="/admin/inquiries/new" variant="primary">
              貼り付けて取り込む
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">受信</th>
                  <th className="px-3 py-2 text-right">経過</th>
                  <th className="px-3 py-2">種類</th>
                  <th className="px-3 py-2">経路</th>
                  <th className="px-3 py-2">お客様</th>
                  <th className="px-3 py-2">要約</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">担当</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const day = calendar.get(i.receivedOn);
                  // 休業日は「休」、祝日で営業する日は「祝」(色だけにしない)
                  const mark = day?.isClosed ? "休" : day?.kind === "national" ? "祝" : "";
                  const late = i.elapsedMinutes !== null && i.elapsedMinutes > REPLY_TARGET_MINUTES;
                  return (
                    <tr key={i.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {formatDateShort(i.receivedOn)}
                        {mark && <span className="ml-1 text-ink-muted">{mark}</span>} {formatTime(i.receivedAt)}
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${late ? "font-bold text-danger" : ""}`}>
                        {i.elapsedMinutes === null ? (
                          "−"
                        ) : (
                          <>
                            {late && <span>● 1時間超 </span>}
                            {formatDuration(i.elapsedMinutes, "table")}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {i.category ? (
                          <span className="inline-flex items-center gap-1">
                            {INQUIRY_CATEGORY_SHORT[i.category]}
                            {i.categorySource === "ai" && <Badge tone="ai">AI</Badge>}
                          </span>
                        ) : (
                          <span className="text-ink-muted">未分類</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{INQUIRY_CHANNELS[i.channel]}</td>
                      <td className="px-3 py-2">
                        {i.customerName ? `${i.customerName} 様` : (i.customerEmail ?? "−")}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/inquiries/${i.id}`} className="font-bold text-primary hover:underline">
                          {i.summary ?? i.subject ?? "（件名なし）"}
                        </Link>
                        {i.childCount > 0 && <span className="ml-1 text-ink-muted">続き{i.childCount}件</span>}
                        {i.hasUnsentDraft && (
                          <span className="ml-1">
                            <Badge tone="warning">未送信の案あり</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge tone={STATUS_TONES[i.status]}>{INQUIRY_STATUSES[i.status]}</Badge>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{i.assigneeName ?? "−"}</td>
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
