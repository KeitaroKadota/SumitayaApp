// D-06 返品依頼への回答の読み書き(D-06 01 7章、03 0.1・EV-01・EV-02・EV-06・EV-07・EV-10、04 CH-02・CH-05・CH-06)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("inquiries", …) を済ませている前提)。
// 注文の検索そのものは B-01 の findOrders に任せ、ここでは探す順番と条件だけを決める。
import { query, transaction, type Sql, type SqlFragment, type SqlLike } from "@/utils/db";
import { todayJST } from "@/utils/jst";
import { findOrders, getOrderWithItems, type OrderDetail, type OrderSummary } from "@/utils/orders";
import { escapeLike } from "@/utils/textNormalize";
import type { Shop } from "@/utils/crossmall/types";
import type {
  OrderItemLimit,
  RequestType,
  ReturnItemInput,
  ReturnReason,
  ReturnStatus,
  ShippingPaidBy,
} from "@/utils/returnRules";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 【仮】注文を探す範囲: 注文日が直近1年、新しい順に最大10件(00_仮決め一覧 D-06-仮-04)
export const RETURN_ORDER_SEARCH_YEARS = 1;
export const RETURN_ORDER_SEARCH_LIMIT = 10;
// G02 は50件ずつ
export const RETURN_PAGE_SIZE = 50;

// 今日の1年前(日本時間の "YYYY-MM-DD")
const searchFrom = (): string => {
  const [y, m, d] = todayJST().split("-");
  // 2/29 の1年前は 2/28 にする
  return `${Number(y) - RETURN_ORDER_SEARCH_YEARS}-${m}-${m === "02" && d === "29" ? "28" : d}`;
};

// 画面に渡す注文の候補(注文者のメール・電話は渡さない)
export type ReturnOrderOption = {
  id: string;
  shop: Shop;
  orderNo: string;
  crossmallOrderNo: string;
  // 日本時間の "YYYY-MM-DD"
  orderedOn: string;
  shippedOn: string | null;
  customerName: string;
  isCancelled: boolean;
};

const jstDate = (d: Date): string => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

export const toOrderOption = (o: OrderSummary): ReturnOrderOption => ({
  id: o.id,
  shop: o.shop,
  orderNo: o.shopOrderNo ?? o.crossmallOrderNo,
  crossmallOrderNo: o.crossmallOrderNo,
  orderedOn: jstDate(o.orderedAt),
  shippedOn: o.shippedOn,
  customerName: o.customerName,
  isCancelled: o.isCancelled,
});

// ---- 0.1 searchOrdersForReturn ----

export const searchOrdersForReturn = async (
  text: string,
  extracted: { orderNumber: string | null; email: string | null }
): Promise<ReturnOrderOption[]> => {
  const base = { from: searchFrom(), limit: RETURN_ORDER_SEARCH_LIMIT };
  const run = async (word: string): Promise<OrderSummary[]> => {
    // 手順2: 注文番号の完全一致(CROSS MALL → モール)
    let found = await findOrders({ ...base, crossmallOrderNo: word });
    if (found.length === 0) found = await findOrders({ ...base, shopOrderNo: word });
    // 手順3: メールアドレス
    if (found.length === 0 && word.includes("@")) found = await findOrders({ ...base, email: word });
    // 手順4: 電話番号 → 名前
    if (found.length === 0 && /\d/.test(word)) found = await findOrders({ ...base, phone: word });
    if (found.length === 0) found = await findOrders({ ...base, name: word });
    return found;
  };
  // 手順1
  const word = text.trim();
  let found: OrderSummary[] = [];
  if (word) found = await run(word);
  else {
    // 言葉が空のときは、抜き出した注文番号、次に問い合わせのメールアドレスで探す
    const orderNumber = extracted.orderNumber?.trim();
    if (orderNumber) {
      found = await findOrders({ ...base, crossmallOrderNo: orderNumber });
      if (found.length === 0) found = await findOrders({ ...base, shopOrderNo: orderNumber });
    }
    if (found.length === 0 && extracted.email?.trim()) found = await findOrders({ ...base, email: extracted.email });
  }
  // 手順5: 注文日の新しい順に最大10件(findOrders が新しい順で返す)
  return found.slice(0, RETURN_ORDER_SEARCH_LIMIT).map(toOrderOption);
};

// ---- EV-02 手順3 注文の明細 ----

// 返品の明細 ri が、注文の明細 i と同じものか。
// B-01 の取り込み直しで order_item_id が空になったもの(0019 の注)は、同じ注文・同じ商品名で見る(00_仮決め一覧 D-06-仮-12)
const sameOrderItem = (sql: SqlLike): SqlFragment => sql`
  (ri.order_item_id = i.id or (ri.order_item_id is null and r.order_id = i.order_id and ri.product_name = i.product_name))`;

export type ReturnOrderItem = OrderItemLimit & {
  productCode: string;
  optionText: string | null;
  hasCustomization: boolean;
  customizationText: string | null;
  // 交換先の候補(同じ品番の、使用中の別の商品。00_仮決め一覧 D-06-仮-08)
  exchangeCandidates: { id: string; label: string }[];
};

export type ReturnOrder = { order: ReturnOrderOption; items: ReturnOrderItem[] };

const productLabel = (p: { product_code: string; name: string; size: string | null; color: string | null }): string =>
  `${p.product_code} ${[p.name, p.color, p.size].filter(Boolean).join(" ")}`;

// 注文と明細(B-01 の getOrderWithItems に、明細のID・返品済みの数・交換先の候補を足す)
export const loadReturnOrder = async (orderId: string): Promise<ReturnOrder | null> => {
  const detail: OrderDetail | null = await getOrderWithItems(orderId);
  if (!detail) return null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        line_no: number;
        product_id: string | null;
        item_code: string | null;
        returned: number;
      }[]
    >`
      select i.id, i.line_no, i.product_id, p.item_code,
             coalesce((select sum(ri.quantity) from return_request_items ri join return_requests r on r.id = ri.return_request_id
                       where ${sameOrderItem(sql)} and r.status not in ('cancelled', 'rejected')), 0)::int as returned
      from order_items i left join products p on p.id = i.product_id
      where i.order_id = ${orderId} order by i.line_no`
  );
  const itemCodes = [...new Set(rows.map((r) => r.item_code).filter((c): c is string => Boolean(c)))];
  const variants =
    itemCodes.length === 0
      ? []
      : await query(
          (sql) => sql<{ id: string; item_code: string; product_code: string; name: string; size: string | null; color: string | null }[]>`
            select id, item_code, product_code, name, size, color from products
            where is_active and item_code = any(${itemCodes}::text[]) order by product_code`
        );
  const items: ReturnOrderItem[] = detail.items.flatMap((i) => {
    const row = rows.find((r) => r.line_no === i.lineNo);
    if (!row) return [];
    return [
      {
        id: row.id,
        productId: i.productId,
        productName: i.productName || i.productCode,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        returnedQuantity: row.returned,
        productCode: i.productCode,
        optionText: i.optionText,
        hasCustomization: i.hasCustomization,
        customizationText: i.customizationText,
        exchangeCandidates: variants
          .filter((v) => row.item_code && v.item_code === row.item_code && v.id !== i.productId)
          .map((v) => ({ id: v.id, label: productLabel(v) })),
      },
    ];
  });
  return { order: toOrderOption(detail), items };
};

// 交換先の商品(使用中の商品だけ。CH-03)。ID か商品コードで引く
export const findExchangeProducts = async (
  ids: string[],
  codes: string[]
): Promise<{ id: string; productCode: string; label: string }[]> => {
  const validIds = ids.filter((id) => UUID_PATTERN.test(id));
  if (validIds.length === 0 && codes.length === 0) return [];
  const rows = await query(
    (sql) => sql<{ id: string; product_code: string; name: string; size: string | null; color: string | null }[]>`
      select id, product_code, name, size, color from products
      where is_active and (id = any(${validIds}::uuid[]) or product_code = any(${codes}::text[]))`
  );
  return rows.map((r) => ({ id: r.id, productCode: r.product_code, label: productLabel(r) }));
};

// ---- EV-01 手順1 この問い合わせの返品 ----

export type ReturnRequestSummary = {
  id: string;
  returnNumber: string;
  status: ReturnStatus;
  requestType: RequestType;
  createdAt: Date;
};

// 同じやり取り(最初の問い合わせ)の返品を新しい順に
export const listReturnsByInquiry = async (rootInquiryId: string): Promise<ReturnRequestSummary[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; return_number: string; status: ReturnStatus; request_type: RequestType; created_at: Date }[]>`
      select id, return_number, status, request_type, created_at from return_requests
      where inquiry_id = ${rootInquiryId} order by created_at desc, id`
  );
  return rows.map((r) => ({
    id: r.id,
    returnNumber: r.return_number,
    status: r.status,
    requestType: r.request_type,
    createdAt: r.created_at,
  }));
};

// ---- EV-06 受付を登録 ----

export type NewReturnInput = {
  inquiryId: string;
  orderId: string | null;
  orderNumber: string | null;
  channel: Shop | null;
  customerName: string | null;
  requestType: RequestType;
  reason: ReturnReason;
  reasonNote: string | null;
  shippingPaidBy: ShippingPaidBy;
  status: ReturnStatus;
  items: (ReturnItemInput & { exchangeProductId: string | null })[];
};

export type InsertReturnResult =
  | { ok: true; id: string; returnNumber: string }
  | { ok: false; reason: "duplicate"; existingId: string; existingNumber: string }
  | { ok: false; reason: "over_quantity"; productName: string };

// 番号は RT-年-通し番号(年ごとに1から。年は日本時間)。同時に作られても番号が重ならないよう、トランザクションの中で鍵をかけて振る
export const insertReturnRequest = async (input: NewReturnInput, year: number, by: string): Promise<InsertReturnResult> =>
  transaction(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('return_requests.return_number'))`;

    // CH-05 同じ問い合わせで、取消でない返品に同じ注文の明細が無い。
    // 【仮】明細の結び付きが無いもの(手で入れた・取り込み直しで空になった)は、同じ商品名で見る(00_仮決め一覧 D-06-仮-12・13)
    const orderItemIds = input.items.map((i) => i.orderItemId).filter((v): v is string => Boolean(v));
    const manualNames = input.items.map((i) => i.productName);
    const [dup] = await tx<{ id: string; return_number: string }[]>`
      select r.id, r.return_number from return_requests r join return_request_items ri on ri.return_request_id = r.id
      where r.inquiry_id = ${input.inquiryId} and r.status <> 'cancelled'
        and (ri.order_item_id = any(${orderItemIds}::uuid[])
             or (ri.order_item_id is null and ri.product_name = any(${manualNames}::text[])))
      order by r.created_at desc limit 1`;
    if (dup) return { ok: false as const, reason: "duplicate" as const, existingId: dup.id, existingNumber: dup.return_number };

    // CH-02 ほかの返品(取消・お断りを除く)と合わせて、注文の数量を超えない(押した時点の値で確かめ直す)
    if (orderItemIds.length > 0 && input.status === "waiting_item") {
      const limits = await tx<{ id: string; product_name: string; quantity: number; returned: number }[]>`
        select i.id, i.product_name, i.quantity,
               coalesce((select sum(ri.quantity) from return_request_items ri join return_requests r on r.id = ri.return_request_id
                         where ${sameOrderItem(tx)} and r.status not in ('cancelled', 'rejected')), 0)::int as returned
        from order_items i where i.id = any(${orderItemIds}::uuid[])`;
      for (const item of input.items) {
        const l = limits.find((x) => x.id === item.orderItemId);
        if (l && l.returned + item.quantity > l.quantity)
          return { ok: false as const, reason: "over_quantity" as const, productName: l.product_name };
      }
    }

    const prefix = `RT-${year}-`;
    const [{ next }] = await tx<{ next: number }[]>`
      select coalesce(max(substring(return_number from ${prefix.length + 1})::int), 0) + 1 as next
      from return_requests where return_number like ${`${prefix}%`}`;
    const returnNumber = `${prefix}${String(next).padStart(4, "0")}`;
    const [row] = await tx<{ id: string }[]>`
      insert into return_requests (return_number, inquiry_id, order_id, order_number, channel, customer_name, request_type,
                                   reason, reason_note, shipping_paid_by, status, created_by, updated_by)
      values (${returnNumber}, ${input.inquiryId}, ${input.orderId}, ${input.orderNumber}, ${input.channel}, ${input.customerName},
              ${input.requestType}, ${input.reason}, ${input.reasonNote}, ${input.shippingPaidBy}, ${input.status}, ${by}, ${by})
      returning id`;
    const items = input.items.map((i) => ({
      return_request_id: row.id,
      order_item_id: i.orderItemId,
      product_id: i.productId,
      product_name: i.productName,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      exchange_product_id: i.exchangeProductId,
    }));
    await tx`
      insert into return_request_items (return_request_id, order_item_id, product_id, product_name, quantity, unit_price,
                                        exchange_product_id)
      select d.return_request_id, d.order_item_id, d.product_id, d.product_name, d.quantity, d.unit_price, d.exchange_product_id
      from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as d (
        return_request_id uuid, order_item_id uuid, product_id uuid, product_name text, quantity integer, unit_price integer,
        exchange_product_id uuid
      )`;
    return { ok: true as const, id: row.id, returnNumber };
  });

// ---- EV-07 一覧(G02) ----

export type ReturnListFilter = { status: ReturnStatus | "all"; q: string };

export type ReturnListItem = {
  id: string;
  returnNumber: string;
  createdAt: Date;
  customerName: string | null;
  channel: Shop | null;
  requestType: RequestType;
  status: ReturnStatus;
  // 「商品名 数 → 交換先」を並べたもの
  itemsText: string;
};

type ReturnListRow = {
  id: string;
  return_number: string;
  created_at: Date;
  customer_name: string | null;
  channel: Shop | null;
  request_type: RequestType;
  status: ReturnStatus;
  items: { name: string; qty: number; exchange: string | null }[] | null;
};

const ITEMS_JSON = (sql: Sql): SqlFragment => sql`
  coalesce((select json_agg(json_build_object('name', ri.product_name, 'qty', ri.quantity,
                                              'exchange', concat_ws(' ', ep.name, ep.color, ep.size)) order by ri.created_at, ri.id)
            from return_request_items ri left join products ep on ep.id = ri.exchange_product_id
            where ri.return_request_id = r.id), '[]'::json)`;

const itemsTextOf = (items: ReturnListRow["items"]): string =>
  (items ?? []).map((i) => `${i.name} ×${i.qty}${i.exchange ? ` → ${i.exchange}` : ""}`).join("／");

export const listReturnRequests = async (
  filter: ReturnListFilter,
  page: number
): Promise<{ total: number; items: ReturnListItem[] }> => {
  const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
  const where = (sql: Sql): SqlFragment => sql`
    true
    ${filter.status === "all" ? sql`` : sql`and r.status = ${filter.status}`}
    ${
      like
        ? sql`and (r.return_number ilike ${like} or r.order_number ilike ${like} or r.customer_name ilike ${like}
                   or o.shop_order_no ilike ${like} or o.crossmall_order_no ilike ${like})`
        : sql``
    }`;
  const [{ total }] = await query(
    (sql) => sql<{ total: number }[]>`
      select count(*)::int as total from return_requests r left join orders o on o.id = r.order_id where ${where(sql)}`
  );
  const rows = await query(
    (sql) => sql<ReturnListRow[]>`
      select r.id, r.return_number, r.created_at, r.customer_name, r.channel, r.request_type, r.status, ${ITEMS_JSON(sql)} as items
      from return_requests r left join orders o on o.id = r.order_id
      where ${where(sql)}
      order by r.created_at desc, r.id
      limit ${RETURN_PAGE_SIZE} offset ${(page - 1) * RETURN_PAGE_SIZE}`
  );
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      returnNumber: r.return_number,
      createdAt: r.created_at,
      customerName: r.customer_name,
      channel: r.channel,
      requestType: r.request_type,
      status: r.status,
      itemsText: itemsTextOf(r.items),
    })),
  };
};

// ---- EV-07 詳細(G03) ----

export type ReturnRequestDetail = {
  id: string;
  returnNumber: string;
  inquiryId: string;
  orderId: string | null;
  orderNumber: string | null;
  channel: Shop | null;
  customerName: string | null;
  requestType: RequestType;
  reason: ReturnReason;
  reasonNote: string | null;
  shippingPaidBy: ShippingPaidBy;
  status: ReturnStatus;
  itemArrivedAt: Date | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
  updatedByName: string | null;
  // 注文(見つかったとき)
  order: { shop: Shop; orderNo: string; orderedAt: Date } | null;
  // 元の問い合わせ
  inquiry: { receivedAt: Date; customerName: string | null; subject: string | null };
  items: {
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number | null;
    exchangeName: string | null;
    receivedQty: number | null;
  }[];
};

export const getReturnRequest = async (id: string): Promise<ReturnRequestDetail | null> => {
  if (!UUID_PATTERN.test(id)) return null;
  const [r] = await query(
    (sql) => sql<
      {
        id: string;
        return_number: string;
        inquiry_id: string;
        order_id: string | null;
        order_number: string | null;
        channel: Shop | null;
        customer_name: string | null;
        request_type: RequestType;
        reason: ReturnReason;
        reason_note: string | null;
        shipping_paid_by: ShippingPaidBy;
        status: ReturnStatus;
        item_arrived_at: Date | null;
        memo: string | null;
        created_at: Date;
        updated_at: Date;
        created_by_name: string | null;
        updated_by_name: string | null;
        o_shop: Shop | null;
        o_order_no: string | null;
        o_ordered_at: Date | null;
        i_received_at: Date;
        i_customer_name: string | null;
        i_subject: string | null;
      }[]
    >`
      select r.id, r.return_number, r.inquiry_id, r.order_id, r.order_number, r.channel, r.customer_name, r.request_type,
             r.reason, r.reason_note, r.shipping_paid_by, r.status, r.item_arrived_at, r.memo, r.created_at, r.updated_at,
             case when c.id is null then null else c.last_name || ' ' || c.first_name end as created_by_name,
             case when u.id is null then null else u.last_name || ' ' || u.first_name end as updated_by_name,
             o.shop as o_shop, coalesce(o.shop_order_no, o.crossmall_order_no) as o_order_no, o.ordered_at as o_ordered_at,
             q.received_at as i_received_at, q.customer_name as i_customer_name, q.subject as i_subject
      from return_requests r
        join inquiries q on q.id = r.inquiry_id
        left join orders o on o.id = r.order_id
        left join employees c on c.id = r.created_by
        left join employees u on u.id = r.updated_by
      where r.id = ${id}`
  );
  if (!r) return null;
  const items = await query(
    (sql) => sql<
      { id: string; product_name: string; quantity: number; unit_price: number | null; exchange_name: string | null; received_qty: number | null }[]
    >`
      select ri.id, ri.product_name, ri.quantity, ri.unit_price, ri.received_qty,
             case when ep.id is null then null else concat_ws(' ', ep.product_code, ep.name, ep.color, ep.size) end as exchange_name
      from return_request_items ri left join products ep on ep.id = ri.exchange_product_id
      where ri.return_request_id = ${id} order by ri.created_at, ri.id`
  );
  return {
    id: r.id,
    returnNumber: r.return_number,
    inquiryId: r.inquiry_id,
    orderId: r.order_id,
    orderNumber: r.order_number,
    channel: r.channel,
    customerName: r.customer_name,
    requestType: r.request_type,
    reason: r.reason,
    reasonNote: r.reason_note,
    shippingPaidBy: r.shipping_paid_by,
    status: r.status,
    itemArrivedAt: r.item_arrived_at,
    memo: r.memo,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdByName: r.created_by_name,
    updatedByName: r.updated_by_name,
    order: r.o_shop && r.o_order_no && r.o_ordered_at ? { shop: r.o_shop, orderNo: r.o_order_no, orderedAt: r.o_ordered_at } : null,
    inquiry: { receivedAt: r.i_received_at, customerName: r.i_customer_name, subject: r.i_subject },
    items: items.map((i) => ({
      id: i.id,
      productName: i.product_name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      exchangeName: i.exchange_name,
      receivedQty: i.received_qty,
    })),
  };
};

// ---- EV-10 取消 ----

// 取消でなければ取消にし、理由をメモに足す(CH-06)。変えられなければ false
export const cancelReturnRequest = async (id: string, reasonLine: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql`
      update return_requests set
        status = 'cancelled',
        memo = left(concat_ws(E'\n', nullif(memo, ''), ${reasonLine}), 2000),
        updated_by = ${by}
      where id = ${id} and status <> 'cancelled'`
  );
  return rows.count > 0;
};

// ---- 返品のひな形(reply_templates の種類 return) ----

export type ReturnTemplateOption = { id: string; purpose: string; name: string; subject: string | null; body: string };

export const listReturnTemplates = async (): Promise<ReturnTemplateOption[]> =>
  query(
    (sql) => sql<ReturnTemplateOption[]>`
      select id, purpose, name, subject, body from reply_templates
      where category = 'return' and is_active
      order by purpose, sort_order, name`
  );
