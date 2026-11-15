import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { festivalCategoryOptions, getFestival, listFestivals } from "@/utils/festivals";
import { formatDateShort } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { Alert } from "@/components/Alert";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { BackLink, LinkButton } from "@/components/LinkButton";
import { Modal } from "@/components/Modal";
import { deleteFestivalAction, saveFestivalAction } from "./actions";
import { FestivalForm } from "./FestivalForm";

const navClass = "inline-flex min-h-11 items-center px-2 text-sm font-bold text-primary hover:underline";
const BASE = "/admin/forecast/festivals";

// G03 祭礼カレンダー(A-03 EV-05)。追加・編集は小窓(?new=1・?edit=ID)
export default async function FestivalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  await requireAccess("sales", BASE);
  const yearParam = Number(params.year);
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 ? yearParam : Number(todayJST().slice(0, 4));
  const yearUrl = (y: number) => `${BASE}?year=${y}`;

  const festivals = await listFestivals(`${year}-01-01`, `${year}-12-31`);
  const categories = festivalCategoryOptions();
  const categoryLabel = (codes: string[]) =>
    codes.length === 0 ? "すべて" : codes.map((c) => categories.find((o) => o.value === c)?.label ?? c).join("・");

  const editId = typeof params.edit === "string" ? params.edit : null;
  const editing = editId ? await getFestival(editId) : null;
  const isNew = params.new === "1";
  const initial = editing
    ? {
        series_key: editing.seriesKey,
        name: editing.name,
        start_date: editing.startDate,
        end_date: editing.endDate,
        region: editing.region ?? "",
        category_codes: editing.categoryCodes.join(","),
        influence_days_before: String(editing.influenceDaysBefore),
        influence_days_after: String(editing.influenceDaysAfter),
        adjust_factor: editing.adjustFactor.toFixed(2),
        is_held: editing.isHeld ? "1" : "",
        note: editing.note ?? "",
      }
    : {
        // 【仮】売れ始めの既定 28日前(00_仮決め一覧 A-03-仮-02)
        series_key: "",
        name: "",
        start_date: "",
        end_date: "",
        region: "",
        category_codes: "",
        influence_days_before: "28",
        influence_days_after: "0",
        adjust_factor: "1.00",
        is_held: "1",
        note: "",
      };
  const saved = params.saved === "1" ? "保存しました。次に予測を計算したときから使われます。" : params.saved === "deleted" ? "削除しました。" : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/forecast" label="予測と発注の提案へ" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">祭礼カレンダー</h1>
        <div className="flex items-center gap-3">
          <nav aria-label="年の切り替え" className="flex items-center gap-3 tabular-nums">
            <Link href={yearUrl(year - 1)} className={navClass}>
              ‹ {year - 1}年
            </Link>
            <span className="font-bold">{year}年</span>
            <Link href={yearUrl(year + 1)} className={navClass}>
              {year + 1}年 ›
            </Link>
          </nav>
          <LinkButton href={`${yearUrl(year)}&new=1`} variant="primary">
            追加
          </LinkButton>
        </div>
      </div>
      {saved && <Alert tone="success">{saved}</Alert>}
      {params.same_year === "1" && <Alert tone="warning">同じつなぐ名前の祭礼が、同じ年にもう1件あります（年に2回ある祭りなら、そのままで大丈夫です）。</Alert>}

      {festivals.length === 0 ? (
        <EmptyState message="この年の祭礼はまだありません。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">祭り（つなぐ名前）</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2">日程</th>
                <th className="px-3 py-2 text-right">売れ始め</th>
                <th className="px-3 py-2">対象の分類</th>
                <th className="px-3 py-2 text-right">倍率</th>
                <th className="px-3 py-2">開催</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {festivals.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2">{f.seriesKey}</td>
                  <td className="px-3 py-2">{f.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatDateShort(f.startDate)}〜{formatDateShort(f.endDate)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.influenceDaysBefore}日前</td>
                  <td className="px-3 py-2">{categoryLabel(f.categoryCodes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.adjustFactor.toFixed(2)}</td>
                  <td className="px-3 py-2">{f.isHeld ? "○" : "中止"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <LinkButton href={`${yearUrl(year)}&edit=${f.id}`}>編集</LinkButton>
                      <form action={deleteFestivalAction.bind(null, f.id)}>
                        <ConfirmSubmitButton
                          variant="secondary"
                          pendingText="削除中…"
                          confirmMessage={`「${f.name}」を削除してよいですか？次に予測を計算したときから使われなくなります。`}
                        >
                          削除
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(isNew || editing) && (
        <Modal title={editing ? "祭礼の編集" : "祭礼の追加"} closeHref={yearUrl(year)}>
          <FestivalForm
            key={editing?.id ?? "new"}
            action={saveFestivalAction.bind(null, editing?.id ?? null)}
            initial={initial}
            categories={categories}
            closeHref={yearUrl(year)}
          />
        </Modal>
      )}
    </div>
  );
}
