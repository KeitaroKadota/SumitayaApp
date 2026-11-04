import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { SHOP_LABELS, isShop, type Shop } from "@/utils/crossmall/types";
import { formatDateShort, formatDateTime, formatQuantity } from "@/utils/format";
import { addDays } from "@/utils/holidays";
import { todayJST } from "@/utils/jst";
import {
  ORDER_PAGE_SIZE,
  countOpenExceptionOrders,
  getLatestImport,
  listCrossmallStatuses,
  listOrders,
  type OrderListFilter,
} from "@/utils/orders";
import { isValidDateStr } from "@/utils/textNormalize";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

// CH-10 検索の期間: YYYY-MM-DD で、開始 ≦ 終了、最大1年。だめなとき(空のときも)は直近30日
const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;
const resolvePeriod = (from: string, to: string): { from: string; to: string } => {
  const today = todayJST();
  const fallback = { from: addDays(today, -(DEFAULT_PERIOD_DAYS - 1)), to: today };
  if (!isValidDateStr(from) || !isValidDateStr(to) || from > to) return fallback;
  if (addDays(from, MAX_PERIOD_DAYS - 1) < to) return fallback;
  return { from, to };
};

// G01 受注の一覧(B-01 EV-01)。検索とページ送りは URL の ?q=&shop=&from=&to=&status=&exception=&cancelled=&page= で持つ
export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAccess("orders", "/admin/orders");
  const params = await searchParams;

  // 手順2: 検索の条件
  const shopParam = str(params.shop);
  const period = resolvePeriod(str(params.from), str(params.to));
  const statuses = await listCrossmallStatuses();
  const statusParam = str(params.status);
  const filter: OrderListFilter = {
    q: str(params.q).slice(0, 100),
    shop: isShop(shopParam) ? (shopParam as Shop) : "",
    from: period.from,
    to: period.to,
    status: statuses.includes(statusParam) ? statusParam : "",
    exceptionOnly: str(params.exception) === "1",
    includeCancelled: str(params.cancelled) === "1",
  };
  const page = Math.max(1, Math.floor(Number(str(params.page)) || 1));

  // 手順3・4
  const { total, items } = await listOrders(filter, page);
  const latest = await getLatestImport("crossmall_orders");
  const openExceptions = await countOpenExceptionOrders();

  const hrefOf = (p: number) => {
    const sp = new URLSearchParams();
    if (filter.q) sp.set("q", filter.q);
    if (filter.shop) sp.set("shop", filter.shop);
    sp.set("from", filter.from);
    sp.set("to", filter.to);
    if (filter.status) sp.set("status", filter.status);
    if (filter.exceptionOnly) sp.set("exception", "1");
    if (filter.includeCancelled) sp.set("cancelled", "1");
    if (p > 1) sp.set("page", String(p));
    return `/admin/orders?${sp.toString()}`;
  };

  // EV-04 手順7: 取り込みの結果(?imported=新規,更新[,例外の数|failed]&sales_skipped=積み上げなかった組の数)
  const imported = str(params.imported).split(",");
  const importedMessage =
    imported.length >= 2 && imported[0] !== ""
      ? `新規${formatQuantity(Number(imported[0]))}件・更新${formatQuantity(Number(imported[1]))}件を登録しました。` +
        (imported[2] && imported[2] !== "failed" ? `例外${formatQuantity(Number(imported[2]))}件` : "")
      : null;
  const salesSkipped = Number(str(params.sales_skipped)) || 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">受注</h1>
        <LinkButton href="/admin/orders/import" variant="primary">
          受注CSVを取り込む
        </LinkButton>
      </div>

      {importedMessage && <Alert tone="success">{importedMessage}</Alert>}
      {imported[2] === "failed" && (
        <Alert tone="warning">例外の確認に失敗しました。もう一度［例外を調べ直す］を押してください。</Alert>
      )}
      {salesSkipped > 0 && (
        <Alert tone="warning">
          売上の取り込み（A-01）の行があるため、売上に積み上げなかった組が{formatQuantity(salesSkipped)}件あります。
        </Alert>
      )}

      <p className="text-sm text-ink-muted">
        {latest
          ? latest.status === "applied"
            ? `最後の取り込み: ${formatDateTime(latest.at)}${latest.byName ? `（${latest.byName}）` : ""} 新規${formatQuantity(latest.addCount)}件・更新${formatQuantity(latest.changeCount)}件`
            : `最後の取り込み: ${formatDateTime(latest.at)} 失敗しました${latest.message ? `（${latest.message}）` : ""}`
          : "まだ取り込んでいません。"}
      </p>
      {/* 例外の案内(未対応があるときだけ)。【仮】B-02 の画面はまだ無いので、件数だけを出す(00_仮決め一覧 B-01-仮-14) */}
      {openExceptions > 0 && <Alert tone="warning">例外注文が {formatQuantity(openExceptions)}件 あります（B-02 で確認）</Alert>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={filter.q} placeholder="注文番号・名前・電話・メール" className="w-72" />
        </Field>
        <Field id="shop" label="販路">
          <Select id="shop" name="shop" defaultValue={filter.shop} className="w-36">
            <option value="">すべて</option>
            {Object.entries(SHOP_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="from" label="期間（開始）">
          <TextInput id="from" name="from" type="date" defaultValue={filter.from} className="w-44" />
        </Field>
        <Field id="to" label="期間（終了）">
          <TextInput id="to" name="to" type="date" defaultValue={filter.to} className="w-44" />
        </Field>
        <Field id="status" label="状態">
          <Select id="status" name="status" defaultValue={filter.status} className="w-44">
            <option value="">すべて</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox name="exception" value="1" label="例外のある注文だけ" defaultChecked={filter.exceptionOnly} />
        <Checkbox name="cancelled" value="1" label="キャンセルを含める" defaultChecked={filter.includeCancelled} />
        <button type="submit" className={buttonClassName("secondary")}>
          検索
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          message={latest ? "条件に合う注文はありません。" : "注文はまだありません。"}
          action={
            <LinkButton href="/admin/orders/import" variant="primary">
              受注CSVを取り込む
            </LinkButton>
          }
        />
      ) : (
        <>
          <Pagination total={total} page={page} pageSize={ORDER_PAGE_SIZE} hrefOf={hrefOf} />
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">注文日</th>
                  <th className="px-3 py-2">販路</th>
                  <th className="px-3 py-2">注文番号</th>
                  <th className="px-3 py-2">注文者</th>
                  <th className="px-3 py-2 text-right">金額（円）</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">例外</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDateShort(o.orderedAt)}</td>
                    <td className="px-3 py-2">{SHOP_LABELS[o.shop]}</td>
                    <td className="px-3 py-2 tabular-nums">
                      <Link href={`/admin/orders/${o.id}`} className="font-bold text-primary hover:underline">
                        {o.shopOrderNo ?? o.crossmallOrderNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{o.customerName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(o.total)}</td>
                    <td className="px-3 py-2">
                      {o.crossmallStatus ?? ""}
                      {o.isCancelled && <span className="ml-1 text-ink-muted">（キャンセル）</span>}
                    </td>
                    <td className="px-3 py-2">
                      {o.exceptionStatus === "open" ? (
                        <span className="text-warning" aria-label="未対応の例外あり">
                          ⚠
                        </span>
                      ) : o.exceptionStatus === "resolved" ? (
                        <span className="text-success" aria-label="対応済み">
                          ✓
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={total} page={page} pageSize={ORDER_PAGE_SIZE} hrefOf={hrefOf} />
        </>
      )}
    </div>
  );
}
