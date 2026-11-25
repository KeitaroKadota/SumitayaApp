// 例外注文(B-02)のDBの読み書き(03 EV-01〜EV-04、04 CH-12・CH-13)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("orders") を済ませている前提)。
// ルールの判定は orderExceptionRules.ts の計算で行う(AIは使わない)。スクロール360への出荷の依頼は作らない(2026-11-08 決定)。
import { query, transaction, type SqlLike } from "@/utils/db";
import { addDays } from "@/utils/holidays";
import { combineDateTimeJST, todayJST } from "@/utils/jst";
import {
  checkOrderExceptions,
  customerKeyOf,
  type ExceptionOrderInput,
  type OrderExceptionRule,
} from "@/utils/orderExceptionRules";
import type { PaymentStatus, Shop } from "@/utils/crossmall/types";

export const ORDER_EXCEPTIONS_URL = "/admin/orders/exceptions";
export const orderUrl = (id: string) => `/admin/orders/${encodeURIComponent(id)}`;

// 1回の SQL で調べる注文の数(B-01 の取り込みは最大2万件を渡してくる)
const CHUNK_SIZE = 500;
// EV-02 「例外を調べ直す」の対象: 直近7日に注文された未出荷の注文
export const RECHECK_DAYS = 7;
// G01 の1ページの件数(00_画面共通ルール 4章)
export const EXCEPTION_PAGE_SIZE = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- EV-01 例外注文を調べる ----

type OrderRow = {
  id: string;
  crossmall_order_no: string;
  shop_order_no: string | null;
  is_cancelled: boolean;
  customer_name: string;
  customer_phone_digits: string | null;
  customer_note: string | null;
  ship_name: string;
  ship_postal_code: string | null;
  ship_prefecture: string | null;
  ship_address1: string | null;
  ship_address2: string | null;
  ship_phone: string | null;
  payment_method: string | null;
  payment_status: PaymentStatus;
};

type ItemRow = {
  order_id: string;
  line_no: number;
  product_id: string | null;
  product_code: string;
  product_name: string;
  option_text: string | null;
  has_customization: boolean;
  customization_text: string | null;
  crossmall_remark: string | null;
};

export type DetectResult = {
  // 調べた注文の数(キャンセルを除く)
  checked: number;
  // いまどれかのルールに当たっている注文の数
  exceptionOrders: number;
  // 新しく作った理由の数
  newExceptions: number;
};

const detectChunk = async (ids: string[]): Promise<DetectResult> => {
  // 手順1: 注文と明細をまとめて読む
  const orders = await query(
    (sql) => sql<OrderRow[]>`
      select id, crossmall_order_no, shop_order_no, is_cancelled, customer_name, customer_phone_digits, customer_note,
             ship_name, ship_postal_code, ship_prefecture, ship_address1, ship_address2, ship_phone, payment_method, payment_status
      from orders where id = any(${ids}::uuid[])`
  );
  if (orders.length === 0) return { checked: 0, exceptionOrders: 0, newExceptions: 0 };
  const items = await query(
    (sql) => sql<ItemRow[]>`
      select i.order_id, i.line_no, i.product_id, i.product_code, i.product_name, i.option_text, i.has_customization,
             i.customization_text, p.crossmall_remark
      from order_items i left join products p on p.id = i.product_id
      where i.order_id = any(${ids}::uuid[]) order by i.order_id, i.line_no`
  );
  // 同梱のルール(CH-04 の2)のため、同じ電話番号の未出荷・キャンセルでない注文を読む(名前はこちらで比べる)
  const phones = [...new Set(orders.map((o) => o.customer_phone_digits).filter((p): p is string => Boolean(p)))];
  const sameCustomer =
    phones.length > 0
      ? await query(
          (sql) => sql<{ id: string; crossmall_order_no: string; shop_order_no: string | null; customer_name: string; customer_phone_digits: string }[]>`
            select id, crossmall_order_no, shop_order_no, customer_name, customer_phone_digits
            from orders
            where customer_phone_digits = any(${phones}::text[]) and shipped_on is null and not is_cancelled`
        )
      : [];
  const openByCustomer = new Map<string, { id: string; no: string }[]>();
  for (const o of sameCustomer) {
    const key = customerKeyOf(o.customer_name, o.customer_phone_digits);
    if (!key) continue;
    openByCustomer.set(key, [...(openByCustomer.get(key) ?? []), { id: o.id, no: o.shop_order_no ?? o.crossmall_order_no }]);
  }

  // 手順2・3: 注文ごとにルールを調べる(キャンセルの注文は調べない)
  const rows: { orderId: string; rule: OrderExceptionRule; reason: string; detail: string }[] = [];
  // still_matches を変えない(当たった・失敗した)組。「注文ID:ルール」
  const keep: string[] = [];
  const checkedIds: string[] = [];
  const cancelledIds: string[] = [];
  const hitOrders = new Set<string>();
  for (const o of orders) {
    if (o.is_cancelled) {
      cancelledIds.push(o.id);
      continue;
    }
    checkedIds.push(o.id);
    const key = customerKeyOf(o.customer_name, o.customer_phone_digits);
    const input: ExceptionOrderInput = {
      customerNote: o.customer_note,
      shipName: o.ship_name,
      shipPostalCode: o.ship_postal_code,
      shipPrefecture: o.ship_prefecture,
      shipAddress1: o.ship_address1,
      shipAddress2: o.ship_address2,
      shipPhone: o.ship_phone,
      paymentMethod: o.payment_method,
      paymentStatus: o.payment_status,
      items: items
        .filter((i) => i.order_id === o.id)
        .map((i) => ({
          lineNo: i.line_no,
          productId: i.product_id,
          productCode: i.product_code,
          productName: i.product_name,
          optionText: i.option_text,
          hasCustomization: i.has_customization,
          customizationText: i.customization_text,
          crossmallRemark: i.crossmall_remark,
        })),
      sameCustomerOpenOrderNos: key ? (openByCustomer.get(key) ?? []).filter((x) => x.id !== o.id).map((x) => x.no) : [],
    };
    const { hits, failed } = checkOrderExceptions(input);
    for (const { rule, hit } of hits) {
      rows.push({ orderId: o.id, rule, reason: hit.reason.slice(0, 1000), detail: JSON.stringify(hit.detail) });
      keep.push(`${o.id}:${rule}`);
      hitOrders.add(o.id);
    }
    for (const rule of failed) keep.push(`${o.id}:${rule}`);
  }

  // 手順4〜6: 1つのトランザクションで書く
  const newExceptions = await transaction(async (tx) => {
    let inserted = 0;
    if (rows.length > 0) {
      // 手順4: 同じ注文・同じルールがあれば理由・当たった値を新しくし、まだ当たっている印を付ける(状態は変えない)
      const result = await tx<{ inserted: boolean }[]>`
        insert into order_exceptions (order_id, rule_code, reason, detail)
        select t.order_id, t.rule_code, t.reason, t.detail::jsonb
        from unnest(${rows.map((r) => r.orderId)}::uuid[], ${rows.map((r) => r.rule)}::text[],
                    ${rows.map((r) => r.reason)}::text[], ${rows.map((r) => r.detail)}::text[])
             as t(order_id, rule_code, reason, detail)
        on conflict (order_id, rule_code) do update
          set reason = excluded.reason, detail = excluded.detail, still_matches = true
        returning (xmax = 0) as inserted`;
      inserted = result.filter((r) => r.inserted).length;
    }
    // 手順5: 前は当たっていて今回は当たらなかった理由
    if (checkedIds.length > 0) {
      await tx`
        update order_exceptions set still_matches = false
        where order_id = any(${checkedIds}::uuid[]) and still_matches
          and (order_id::text || ':' || rule_code) <> all(${keep}::text[])`;
    }
    // 手順2: キャンセルの注文は、残っている理由を「もう当たっていない」にする
    if (cancelledIds.length > 0) {
      await tx`update order_exceptions set still_matches = false where order_id = any(${cancelledIds}::uuid[]) and still_matches`;
    }
    // 手順6: 未対応の理由が1つでもあれば、注文の例外の状態を open にする
    await tx`
      update orders o set exception_status = 'open'
      where o.id = any(${checkedIds}::uuid[]) and o.exception_status <> 'open'
        and exists (select 1 from order_exceptions e where e.order_id = o.id and e.status = 'open')`;
    return inserted;
  });

  return { checked: checkedIds.length, exceptionOrders: hitOrders.size, newExceptions };
};

// detectOrderExceptions(注文IDの一覧)。B-01 の受注の登録のあとと、G01 の「例外を調べ直す」から呼ぶ
export const detectOrderExceptions = async (orderIds: string[]): Promise<DetectResult> => {
  const ids = [...new Set(orderIds.filter((id) => UUID_PATTERN.test(id)))];
  const total: DetectResult = { checked: 0, exceptionOrders: 0, newExceptions: 0 };
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const r = await detectChunk(ids.slice(i, i + CHUNK_SIZE));
    total.checked += r.checked;
    total.exceptionOrders += r.exceptionOrders;
    total.newExceptions += r.newExceptions;
  }
  return total;
};

// ---- EV-02 例外を調べ直す ----

// 直近7日に注文された、未出荷でキャンセルでない注文を調べ直す
export const recheckRecentOrders = async (): Promise<DetectResult> => {
  const from = combineDateTimeJST(addDays(todayJST(), -(RECHECK_DAYS - 1)), "00:00");
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from orders where ordered_at >= ${from} and shipped_on is null and not is_cancelled`
  );
  return detectOrderExceptions(rows.map((r) => r.id));
};

// ---- EV-03 例外注文の一覧 ----

export type ExceptionStatusFilter = "open" | "resolved" | "all";

export type OrderExceptionView = {
  id: string;
  rule: OrderExceptionRule;
  reason: string;
  status: "open" | "resolved";
  stillMatches: boolean;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export type ExceptionOrderSummary = {
  id: string;
  shop: Shop;
  crossmallOrderNo: string;
  shopOrderNo: string | null;
  orderedAt: Date;
  customerName: string;
  requestedDeliveryDate: string | null;
  exceptions: OrderExceptionView[];
};

type ExceptionRow = {
  id: string;
  order_id: string;
  rule_code: OrderExceptionRule;
  reason: string;
  status: "open" | "resolved";
  still_matches: boolean;
  resolution_note: string | null;
  resolved_by_name: string | null;
  resolved_at: Date | null;
  created_at: Date;
};

const toView = (r: ExceptionRow): OrderExceptionView => ({
  id: r.id,
  rule: r.rule_code,
  reason: r.reason,
  status: r.status,
  stillMatches: r.still_matches,
  resolutionNote: r.resolution_note,
  resolvedByName: r.resolved_by_name,
  resolvedAt: r.resolved_at,
  createdAt: r.created_at,
});

const exceptionCond = (sql: SqlLike, status: ExceptionStatusFilter, rule: OrderExceptionRule | "") => sql`
  ${status === "all" ? sql`true` : sql`e.status = ${status}`}
  ${rule ? sql`and e.rule_code = ${rule}` : sql``}`;

// 条件(状態・理由)に合う理由を持つ注文を、お届け希望日の近い順 → 注文日時の古い順に読む
export const listExceptionOrders = async (
  status: ExceptionStatusFilter,
  rule: OrderExceptionRule | "",
  page: number
): Promise<{ total: number; items: ExceptionOrderSummary[] }> => {
  const [count] = await query(
    (sql) => sql<{ n: number }[]>`
      select count(*)::int as n from orders o
      where exists (select 1 from order_exceptions e where e.order_id = o.id and ${exceptionCond(sql, status, rule)})`
  );
  const orders = await query(
    (sql) => sql<
      {
        id: string;
        shop: Shop;
        crossmall_order_no: string;
        shop_order_no: string | null;
        ordered_at: Date;
        customer_name: string;
        requested_delivery_date: string | null;
      }[]
    >`
      select o.id, o.shop, o.crossmall_order_no, o.shop_order_no, o.ordered_at, o.customer_name,
             to_char(o.requested_delivery_date, 'YYYY-MM-DD') as requested_delivery_date
      from orders o
      where exists (select 1 from order_exceptions e where e.order_id = o.id and ${exceptionCond(sql, status, rule)})
      order by o.requested_delivery_date asc nulls last, o.ordered_at asc, o.crossmall_order_no
      limit ${EXCEPTION_PAGE_SIZE} offset ${(page - 1) * EXCEPTION_PAGE_SIZE}`
  );
  const ids = orders.map((o) => o.id);
  // 1行の中に並べる理由は、状態の条件に合うもの(理由の絞り込みは注文を選ぶときだけに使い、ほかの理由も並べる)
  const exceptions =
    ids.length > 0
      ? await query(
          (sql) => sql<ExceptionRow[]>`
            select e.id, e.order_id, e.rule_code, e.reason, e.status, e.still_matches, e.resolution_note,
                   case when r.id is null then null else r.last_name || ' ' || r.first_name end as resolved_by_name,
                   e.resolved_at, e.created_at
            from order_exceptions e left join employees r on r.id = e.resolved_by
            where e.order_id = any(${ids}::uuid[]) and ${exceptionCond(sql, status, "")}
            order by e.created_at, e.rule_code`
        )
      : [];
  return {
    total: count?.n ?? 0,
    items: orders.map((o) => ({
      id: o.id,
      shop: o.shop,
      crossmallOrderNo: o.crossmall_order_no,
      shopOrderNo: o.shop_order_no,
      orderedAt: o.ordered_at,
      customerName: o.customer_name,
      requestedDeliveryDate: o.requested_delivery_date,
      exceptions: exceptions.filter((e) => e.order_id === o.id).map(toView),
    })),
  };
};

// ---- G02 例外の対応欄 ----

// その注文の理由(未対応・対応済みのすべて。検出の古い順)
export const listOrderExceptions = async (orderId: string): Promise<OrderExceptionView[]> => {
  if (!UUID_PATTERN.test(orderId)) return [];
  const rows = await query(
    (sql) => sql<ExceptionRow[]>`
      select e.id, e.order_id, e.rule_code, e.reason, e.status, e.still_matches, e.resolution_note,
             case when r.id is null then null else r.last_name || ' ' || r.first_name end as resolved_by_name,
             e.resolved_at, e.created_at
      from order_exceptions e left join employees r on r.id = e.resolved_by
      where e.order_id = ${orderId}
      order by e.created_at, e.rule_code`
  );
  return rows.map(toView);
};

// ---- EV-04 対応済みにする ----

// 未対応の理由をすべて対応済みにする(1つのトランザクション)。CH-12: 未対応が残っていなければ false(何もしない)
export const resolveOrderExceptions = async (orderId: string, note: string | null, by: string): Promise<boolean> =>
  transaction(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      update order_exceptions set status = 'resolved', resolution_note = ${note}, resolved_by = ${by}, resolved_at = now(),
             updated_by = ${by}
      where order_id = ${orderId} and status = 'open'
      returning id`;
    if (updated.length === 0) return false;
    await tx`update orders set exception_status = 'resolved' where id = ${orderId}`;
    return true;
  });
