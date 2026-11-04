import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { SHOP_LABELS } from "@/utils/crossmall/types";
import { formatDateShort } from "@/utils/format";
import { RETURN_PAGE_SIZE, listReturnRequests, type ReturnListFilter } from "@/utils/returnRequests";
import { RETURN_STATUSES, REQUEST_TYPES, isReturnStatus } from "@/utils/returnRules";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Pagination } from "@/components/Pagination";
import { TextInput } from "@/components/TextInput";
import { RETURN_STATUS_TONES } from "./returnView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

// D-06 G02 返品の一覧(03 EV-07)。状態・番号・注文番号・お客様名で絞り込み、新しい順に50件ずつ
export default async function ReturnRequestsPage({ searchParams }: PageProps<"/admin/inquiries/returns">) {
  await requireAccess("inquiries", "/admin/inquiries/returns");
  const params = await searchParams;
  const statusParam = str(params.status);
  // 【仮】初めは返送待ちだけを出す(02 G02 の例。00_仮決め一覧 D-06-仮-15)
  const filter: ReturnListFilter = {
    status: statusParam === "all" || isReturnStatus(statusParam) ? statusParam : "waiting_item",
    q: str(params.q).slice(0, 100),
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));
  const { total, items } = await listReturnRequests(filter, page);

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (filter.status !== "waiting_item") sp.set("status", filter.status);
    if (filter.q) sp.set("q", filter.q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/inquiries/returns${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">返品・交換</h1>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="status" label="状態">
          <AutoSubmitSelect id="status" name="status" defaultValue={filter.status} className="w-48">
            {Object.entries(RETURN_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="all">すべて</option>
          </AutoSubmitSelect>
        </Field>
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={filter.q} placeholder="番号・注文番号・お客様名" className="w-64" />
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          message={
            filter.q || filter.status !== "waiting_item"
              ? "条件に合う返品はありません。"
              : "返送待ちの返品はありません。種類が「返品・交換の依頼」の問い合わせの画面から登録できます。"
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">番号</th>
                  <th className="px-3 py-2">受付</th>
                  <th className="px-3 py-2">お客様</th>
                  <th className="px-3 py-2">販路</th>
                  <th className="px-3 py-2">依頼</th>
                  <th className="px-3 py-2">商品</th>
                  <th className="px-3 py-2">状態</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={`/admin/inquiries/returns/${r.id}`} className="font-bold text-primary hover:underline">
                        {r.returnNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDateShort(r.createdAt)}</td>
                    <td className="px-3 py-2">{r.customerName ? `${r.customerName} 様` : "−"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.channel ? SHOP_LABELS[r.channel] : "−"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{REQUEST_TYPES[r.requestType]}</td>
                    <td className="px-3 py-2">{r.itemsText || "−"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge tone={RETURN_STATUS_TONES[r.status]}>{RETURN_STATUSES[r.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={RETURN_PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
    </div>
  );
}
