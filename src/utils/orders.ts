// 受注(orders・order_items)の取り込み・一覧・ほかの機能が使う検索の関数(B-01 01 7.1・7.3、03 EV-01〜EV-04・EV-08、
// 04 CH-08・CH-10・CH-13・CH-14)。権限チェックはしない(呼ぶ側の画面・操作で requireAccess を済ませている前提)。
// 取り込み元(CSV・将来の API)は NormalizedOrder にそろえてから、ここの登録の処理に渡す(01 9章)。
import { query, type Sql, type SqlFragment, type TransactionSql } from "@/utils/db";
import type { ImportCounts } from "@/utils/csvImport/batches";
import type { CsvRow } from "@/utils/csvImport/engine";
import { resolveProductCodes } from "@/utils/masters";
import { escapeLike, katakanaToHiragana, toHalfWidth } from "@/utils/textNormalize";
import { normalizeEmail, parseOrderCsv, phoneDigits, type ParsedOrderEntry } from "@/utils/crossmall/csvSource";
import { getCrossmallCutoverDate, rebuildOrderSales } from "@/utils/crossmall/laterLinks";
import type { NormalizedOrder, PaymentStatus, Shop } from "@/utils/crossmall/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 【仮】1回に取り込める行数(00_仮決め一覧 B-01-仮-12)
export const ORDER_CSV_MAX_ROWS = 20_000;
// 1回の SQL で送る注文の数(EV-04 の注「100件ごとに区切る」)
const CHUNK_SIZE = 100;
// 確認の画面に返す行の数(区分ごと)
export const ORDER_PREVIEW_ROWS_PER_KIND = 200;
// G01 は50件ずつ(02 G01)
export const ORDER_PAGE_SIZE = 50;
// findOrders の件数の既定(01 7.3)
const FIND_ORDERS_DEFAULT_LIMIT = 20;

// 注文日時の日本時間の日付("YYYY-MM-DD")
export const jstDateOf = (d: Date): string => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// 並べ替えても同じ文字になる JSON(取り込み直したときに「変更なし」かを見るため。jsonb はキーの順番を変える)
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const chunks = <T>(list: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK_SIZE) out.push(list.slice(i, i + CHUNK_SIZE));
  return out;
};

// ---- 取り込み(EV-03・EV-04) ----

export type OrderPlanKind = "add" | "update" | "same" | "error";

export type OrderPlanEntry = ParsedOrderEntry & {
  kind: OrderPlanKind;
  // 明細の行番号(lineNo) → 商品ID(商品マスタに無ければ null。CH-08)
  productIds: (string | null)[];
  // 取り込み前の注文日(日本時間)。注文日が変わったときに売上を作り直すため(01 7.5)
  previousOrderedOn: string | null;
};

export type OrderImportPlan =
  | {
      ok: true;
      dataRowCount: number;
      unusedColumns: string[];
      entries: OrderPlanEntry[];
      counts: ImportCounts;
      // 商品マスタに無い商品コード(CH-08)
      unknownProductCodes: string[];
      // 切替日(未設定なら null)と、売上に積み上げる注文の数・積み上げない組の警告(CH-14)
      cutoverDate: string | null;
      salesTargetCount: number;
      salesWarnings: string[];
    }
  | { ok: false; error: string };

type ExistingOrderRow = { crossmall_order_no: string; raw_row: unknown; ordered_at: Date; product_ids: (string | null)[] };

// EV-03 手順4〜8: 見出し・行のチェック、受注番号でまとめる、商品マスタを引く、今の受注と比べて分ける。確認と登録の両方で呼ぶ
export const planOrderImport = async (header: string[], rows: CsvRow[]): Promise<OrderImportPlan> => {
  const parsed = parseOrderCsv(header, rows);
  if (!parsed.ok) return parsed;

  // 手順7 CH-08 商品コードで商品マスタを引く(読み替えの表 product_code_aliases も見る。CMN-02 の resolveProductCodes)
  const codes = [...new Set(parsed.entries.flatMap((e) => e.order?.items.map((i) => i.productCode) ?? []))];
  const products = await resolveProductCodes("crossmall", codes);
  const unknownProductCodes = codes.filter((c) => !products.has(c));

  // 手順8 今の受注を受注番号で引く
  const orderNos = parsed.entries.filter((e) => e.order).map((e) => e.crossmallOrderNo);
  const existingRows =
    orderNos.length === 0
      ? []
      : await query(
          (sql) => sql<ExistingOrderRow[]>`
            select o.crossmall_order_no, o.raw_row, o.ordered_at,
                   coalesce((select json_agg(i.product_id order by i.line_no) from order_items i where i.order_id = o.id), '[]'::json)
                     as product_ids
            from orders o where o.crossmall_order_no = any(${orderNos}::text[])`,
          { timeoutMs: 30_000 }
        );
  const existing = new Map(existingRows.map((r) => [r.crossmall_order_no, r]));

  const entries: OrderPlanEntry[] = parsed.entries.map((e) => {
    if (!e.order) return { ...e, kind: "error", productIds: [], previousOrderedOn: null };
    const productIds = e.order.items.map((i) => products.get(i.productCode)?.id ?? null);
    const current = existing.get(e.crossmallOrderNo);
    if (!current) return { ...e, kind: "add", productIds, previousOrderedOn: null };
    // 元の行と、商品の結び付き(あとから商品マスタに足した場合)が同じなら「変更なし」
    const same =
      canonicalJson(current.raw_row) === canonicalJson(e.order.rawRows) &&
      canonicalJson(current.product_ids) === canonicalJson(productIds);
    return { ...e, kind: same ? "same" : "update", productIds, previousOrderedOn: jstDateOf(current.ordered_at) };
  });

  // CH-14 売上に積み上げる注文(切替日が未設定なら積み上げない)
  const cutoverDate = await getCrossmallCutoverDate();
  let salesTargetCount = 0;
  let salesWarnings: string[] = [];
  if (cutoverDate) {
    const changed = entries.filter((e) => e.kind === "add" || e.kind === "update");
    salesTargetCount = changed.filter((e) => e.order && !e.order.isCancelled && jstDateOf(e.order.orderedAt) >= cutoverDate).length;
    salesWarnings = (await rebuildOrderSales(null, salesDatesOf(changed), cutoverDate)) ?? [];
  }

  const count = (k: OrderPlanKind) => entries.filter((e) => e.kind === k).length;
  return {
    ok: true,
    dataRowCount: parsed.dataRowCount,
    unusedColumns: parsed.unusedColumns,
    entries,
    counts: { add: count("add"), change: count("update"), same: count("same"), delete: 0, skip: 0, error: count("error") },
    unknownProductCodes,
    cutoverDate,
    salesTargetCount,
    salesWarnings,
  };
};

// 売上を作り直す日: 取り込んだ注文の注文日(取り込み前・後の両方。01 7.5)
const salesDatesOf = (entries: OrderPlanEntry[]): string[] => {
  const dates = new Set<string>();
  for (const e of entries) {
    if (e.order) dates.add(jstDateOf(e.order.orderedAt));
    if (e.previousOrderedOn) dates.add(e.previousOrderedOn);
  }
  return [...dates].sort();
};

// 確認の画面に返す行(エラー → 更新 → 新規 → 変更なし の順に、区分ごとに最大200行)
export type OrderPreviewRow = {
  line: number;
  kind: OrderPlanKind;
  crossmallOrderNo: string;
  // ISO の文字列(エラーで読めなかったときは null)
  orderedAt: string | null;
  detail: string;
  warning: string | null;
};

export const previewOrderRows = (entries: OrderPlanEntry[]): OrderPreviewRow[] =>
  (["error", "update", "add", "same"] as const).flatMap((kind) =>
    entries
      .filter((e) => e.kind === kind)
      .slice(0, ORDER_PREVIEW_ROWS_PER_KIND)
      .map((e) => {
        const items = e.order?.items ?? [];
        const firstItem = items[0];
        const summary = firstItem
          ? `${firstItem.productName || firstItem.productCode} ×${firstItem.quantity}${items.length > 1 ? " ほか" : ""}`
          : "";
        return {
          line: e.lines[0],
          kind: e.kind,
          crossmallOrderNo: e.crossmallOrderNo,
          orderedAt: e.order ? e.order.orderedAt.toISOString() : null,
          detail: e.kind === "error" ? e.errors.join("／") : summary,
          warning: e.warnings.length > 0 ? e.warnings.join("／") : null,
        };
      })
  );

const orderRecord = (o: NormalizedOrder) => ({
  crossmall_order_no: o.crossmallOrderNo,
  shop: o.shop,
  shop_order_no: o.shopOrderNo,
  ordered_at: o.orderedAt.toISOString(),
  crossmall_status: o.crossmallStatus,
  is_cancelled: o.isCancelled,
  shipped_on: o.shippedOn,
  customer_name: o.customerName,
  customer_kana: o.customerKana,
  customer_email: o.customerEmail,
  customer_phone: o.customerPhone,
  customer_phone_digits: o.customerPhoneDigits,
  ship_name: o.shipName,
  ship_postal_code: o.shipPostalCode,
  ship_prefecture: o.shipPrefecture,
  ship_address1: o.shipAddress1,
  ship_address2: o.shipAddress2,
  ship_phone: o.shipPhone,
  payment_method: o.paymentMethod,
  payment_status: o.paymentStatus,
  requested_delivery_date: o.requestedDeliveryDate,
  customer_note: o.customerNote,
  subtotal: o.subtotal,
  shipping_fee: o.shippingFee,
  discount: o.discount,
  tax: o.tax,
  total: o.total,
  raw_row: o.rawRows,
});

export type ApplyOrdersResult = {
  added: number;
  updated: number;
  // 新規・更新になった注文のID(B-02 に渡す)
  orderIds: string[];
  // 売上を積み上げなかった組の警告(CH-14)。切替日が未設定・A-01 が未実装なら null
  salesWarnings: string[] | null;
};

// EV-04 手順4: 新規・更新の注文を登録する(呼ぶ側のトランザクションの中で動かす)。
// 変更なしの注文は書かない。API の取り込み(EV-09)からも同じ関数を呼ぶ
export const applyOrders = async (
  tx: TransactionSql,
  entries: OrderPlanEntry[],
  importBatchId: string | null,
  cutoverDate: string | null
): Promise<ApplyOrdersResult> => {
  const targets = entries.filter((e): e is OrderPlanEntry & { order: NormalizedOrder } =>
    Boolean(e.order && (e.kind === "add" || e.kind === "update"))
  );
  let added = 0;
  let updated = 0;
  const orderIds: string[] = [];

  for (const chunk of chunks(targets)) {
    // 手順4-1 受注番号で上書き登録(無ければ新規)。exception_status は新規なら既定の none、既存なら今の値を残す
    const records = JSON.stringify(chunk.map((e) => orderRecord(e.order)));
    const saved = await tx<{ id: string; crossmall_order_no: string; inserted: boolean }[]>`
      insert into orders (
        crossmall_order_no, shop, shop_order_no, ordered_at, crossmall_status, is_cancelled, shipped_on,
        customer_name, customer_kana, customer_email, customer_phone, customer_phone_digits,
        ship_name, ship_postal_code, ship_prefecture, ship_address1, ship_address2, ship_phone,
        payment_method, payment_status, requested_delivery_date, customer_note,
        subtotal, shipping_fee, discount, tax, total, raw_row, import_batch_id
      )
      select d.crossmall_order_no, d.shop, d.shop_order_no, d.ordered_at, d.crossmall_status, d.is_cancelled, d.shipped_on,
             d.customer_name, d.customer_kana, d.customer_email, d.customer_phone, d.customer_phone_digits,
             d.ship_name, d.ship_postal_code, d.ship_prefecture, d.ship_address1, d.ship_address2, d.ship_phone,
             d.payment_method, d.payment_status, d.requested_delivery_date, d.customer_note,
             d.subtotal, d.shipping_fee, d.discount, d.tax, d.total, d.raw_row, ${importBatchId}::uuid
      from jsonb_to_recordset(${records}::jsonb) as d (
        crossmall_order_no text, shop text, shop_order_no text, ordered_at timestamptz, crossmall_status text,
        is_cancelled boolean, shipped_on date, customer_name text, customer_kana text, customer_email text,
        customer_phone text, customer_phone_digits text, ship_name text, ship_postal_code text, ship_prefecture text,
        ship_address1 text, ship_address2 text, ship_phone text, payment_method text, payment_status text,
        requested_delivery_date date, customer_note text, subtotal integer, shipping_fee integer, discount integer,
        tax integer, total integer, raw_row jsonb
      )
      on conflict (crossmall_order_no) do update set
        shop = excluded.shop, shop_order_no = excluded.shop_order_no, ordered_at = excluded.ordered_at,
        crossmall_status = excluded.crossmall_status, is_cancelled = excluded.is_cancelled,
        shipped_on = excluded.shipped_on, customer_name = excluded.customer_name, customer_kana = excluded.customer_kana,
        customer_email = excluded.customer_email, customer_phone = excluded.customer_phone,
        customer_phone_digits = excluded.customer_phone_digits, ship_name = excluded.ship_name,
        ship_postal_code = excluded.ship_postal_code, ship_prefecture = excluded.ship_prefecture,
        ship_address1 = excluded.ship_address1, ship_address2 = excluded.ship_address2, ship_phone = excluded.ship_phone,
        payment_method = excluded.payment_method, payment_status = excluded.payment_status,
        requested_delivery_date = excluded.requested_delivery_date, customer_note = excluded.customer_note,
        subtotal = excluded.subtotal, shipping_fee = excluded.shipping_fee, discount = excluded.discount,
        tax = excluded.tax, total = excluded.total, raw_row = excluded.raw_row, import_batch_id = excluded.import_batch_id
      returning id, crossmall_order_no, (xmax = 0) as inserted`;
    const idByNo = new Map(saved.map((s) => [s.crossmall_order_no, s.id]));
    for (const s of saved) {
      if (s.inserted) added += 1;
      else updated += 1;
      orderIds.push(s.id);
    }

    // 手順4-2 その注文の明細を消して入れ直す(CROSS MALL 側で明細が変わることがあるため)
    const ids = saved.map((s) => s.id);
    await tx`delete from order_items where order_id = any(${ids}::uuid[])`;
    const items = chunk.flatMap((e) =>
      e.order.items.map((i, n) => ({
        order_id: idByNo.get(e.crossmallOrderNo),
        line_no: i.lineNo,
        product_code: i.productCode,
        product_id: e.productIds[n] ?? null,
        product_name: i.productName,
        option_text: i.optionText,
        has_customization: i.hasCustomization,
        customization_text: i.customizationText,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        amount: i.amount,
      }))
    );
    if (items.length > 0) {
      await tx`
        insert into order_items (
          order_id, line_no, product_code, product_id, product_name, option_text, has_customization,
          customization_text, quantity, unit_price, amount
        )
        select d.order_id, d.line_no, d.product_code, d.product_id, d.product_name, d.option_text, d.has_customization,
               d.customization_text, d.quantity, d.unit_price, d.amount
        from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as d (
          order_id uuid, line_no integer, product_code text, product_id uuid, product_name text, option_text text,
          has_customization boolean, customization_text text, quantity integer, unit_price integer, amount integer
        )`;
    }
  }

  // 手順4-3 切替日が設定されていれば、注文日ごとに sales_daily の source = 'orders' の行を作り直す(同じトランザクション)
  const salesWarnings = cutoverDate ? await rebuildOrderSales(tx, salesDatesOf(targets), cutoverDate) : null;

  return { added, updated, orderIds, salesWarnings };
};

// ---- 一覧・詳細(EV-01・EV-02) ----

const KATAKANA = Array.from({ length: 0x30f6 - 0x30a1 + 1 }, (_, i) => String.fromCharCode(0x30a1 + i)).join("");
const HIRAGANA = Array.from({ length: 0x30f6 - 0x30a1 + 1 }, (_, i) => String.fromCharCode(0x3041 + i)).join("");

// CH-13 注文番号: 前後の空白を取り、全角英数字を半角に、ハイフン・空白を取り除く
const normalizeOrderNo = (value: string): string => toHalfWidth(value).replace(/[-‐－ー−\s]/g, "");
// CH-13 名前: ひらがな・カタカナ・空白の違いを無視する
const normalizeName = (value: string): string => katakanaToHiragana(value).replace(/\s/g, "");

// 検索の条件(SQL の部品)。列の側も同じように整えて比べる
const orderNoMatch = (sql: Sql, column: "crossmall_order_no" | "shop_order_no", value: string): SqlFragment => {
  const col = sql(`o.${column}`);
  return sql`(${col} = ${value.trim()} or regexp_replace(normalize(${col}, NFKC), '[-‐－ー−[:space:]]', '', 'g') = ${normalizeOrderNo(value)})`;
};
const nameMatch = (sql: Sql, value: string): SqlFragment => {
  const like = `%${escapeLike(normalizeName(value))}%`;
  const norm = (col: SqlFragment) =>
    sql`translate(regexp_replace(normalize(${col}, NFKC), '[[:space:]]', '', 'g'), ${KATAKANA}, ${HIRAGANA})`;
  return sql`(${norm(sql`o.customer_name`)} ilike ${like} or ${norm(sql`o.customer_kana`)} ilike ${like})`;
};

// 期間(日本時間の日付 "YYYY-MM-DD"。to はその日を含む)
const periodMatch = (sql: Sql, from: string | undefined, to: string | undefined): SqlFragment => sql`
  ${from ? sql`and o.ordered_at >= (${from}::date)::timestamp at time zone 'Asia/Tokyo'` : sql``}
  ${to ? sql`and o.ordered_at < (${to}::date + 1)::timestamp at time zone 'Asia/Tokyo'` : sql``}`;

export type OrderSummary = {
  id: string;
  crossmallOrderNo: string;
  shop: Shop;
  shopOrderNo: string | null;
  orderedAt: Date;
  crossmallStatus: string | null;
  isCancelled: boolean;
  shippedOn: string | null;
  customerName: string;
  customerKana: string;
  customerEmail: string | null;
  customerPhone: string | null;
  total: number;
  exceptionStatus: "none" | "open" | "resolved";
};

type OrderSummaryRow = {
  id: string;
  crossmall_order_no: string;
  shop: Shop;
  shop_order_no: string | null;
  ordered_at: Date;
  crossmall_status: string | null;
  is_cancelled: boolean;
  shipped_on: string | null;
  customer_name: string;
  customer_kana: string;
  customer_email: string | null;
  customer_phone: string | null;
  total: number;
  exception_status: OrderSummary["exceptionStatus"];
};

const SUMMARY_COLUMNS = (sql: Sql) => sql`
  o.id, o.crossmall_order_no, o.shop, o.shop_order_no, o.ordered_at, o.crossmall_status, o.is_cancelled,
  to_char(o.shipped_on, 'YYYY-MM-DD') as shipped_on, o.customer_name, o.customer_kana, o.customer_email,
  o.customer_phone, o.total, o.exception_status`;

const toSummary = (r: OrderSummaryRow): OrderSummary => ({
  id: r.id,
  crossmallOrderNo: r.crossmall_order_no,
  shop: r.shop,
  shopOrderNo: r.shop_order_no,
  orderedAt: r.ordered_at,
  crossmallStatus: r.crossmall_status,
  isCancelled: r.is_cancelled,
  shippedOn: r.shipped_on,
  customerName: r.customer_name,
  customerKana: r.customer_kana,
  customerEmail: r.customer_email,
  customerPhone: r.customer_phone,
  total: r.total,
  exceptionStatus: r.exception_status,
});

export type OrderListFilter = {
  q: string;
  shop: Shop | "";
  from: string;
  to: string;
  status: string;
  exceptionOnly: boolean;
  includeCancelled: boolean;
};

// EV-01 手順3: 条件で受注を探す(キャンセルは既定で除く)。注文日時の新しい順に50件
export const listOrders = async (
  filter: OrderListFilter,
  page: number
): Promise<{ total: number; items: OrderSummary[] }> => {
  const where = (sql: Sql) => {
    const q = filter.q;
    const digits = q ? phoneDigits(q) : null;
    const email = q.includes("@") ? normalizeEmail(q) : null;
    // 検索: 注文番号(CROSS MALL・モール)・電話・メールは一致、名前(ふりがなも)は部分一致(02 G01)
    const search = q
      ? sql`and (${orderNoMatch(sql, "crossmall_order_no", q)} or ${orderNoMatch(sql, "shop_order_no", q)}
               ${email ? sql`or o.customer_email = ${email}` : sql``}
               ${digits ? sql`or o.customer_phone_digits = ${digits}` : sql``}
               or ${nameMatch(sql, q)})`
      : sql``;
    return sql`
      where true
        ${filter.includeCancelled ? sql`` : sql`and not o.is_cancelled`}
        ${filter.shop ? sql`and o.shop = ${filter.shop}` : sql``}
        ${filter.status ? sql`and o.crossmall_status = ${filter.status}` : sql``}
        ${filter.exceptionOnly ? sql`and o.exception_status = 'open'` : sql``}
        ${periodMatch(sql, filter.from, filter.to)}
        ${search}`;
  };
  const countRows = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from orders o ${where(sql)}`);
  const rows = await query(
    (sql) => sql<OrderSummaryRow[]>`
      select ${SUMMARY_COLUMNS(sql)} from orders o ${where(sql)}
      order by o.ordered_at desc, o.crossmall_order_no desc
      limit ${ORDER_PAGE_SIZE} offset ${(page - 1) * ORDER_PAGE_SIZE}`
  );
  return { total: countRows[0]?.n ?? 0, items: rows.map(toSummary) };
};

// 状態の絞り込みの選択肢(crossmall_status の値の一覧。02 G01)
export const listCrossmallStatuses = async (): Promise<string[]> => {
  const rows = await query(
    (sql) => sql<{ crossmall_status: string }[]>`
      select distinct crossmall_status from orders where crossmall_status is not null order by crossmall_status`
  );
  return rows.map((r) => r.crossmall_status);
};

// 例外が未対応(open)の注文の数(02 G01 の例外の案内)
export const countOpenExceptionOrders = async (): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ n: number }[]>`select count(*)::int as n from orders where exception_status = 'open'`
  );
  return rows[0]?.n ?? 0;
};

export type LatestImport = {
  status: "applied" | "failed";
  at: Date;
  byName: string | null;
  addCount: number;
  changeCount: number;
  message: string | null;
};

// 最後の取り込み(import_batches の種類の最新1件。登録済みか、将来の API の失敗)
export const getLatestImport = async (kind: "crossmall_orders" | "crossmall_stock"): Promise<LatestImport | null> => {
  const rows = await query(
    (sql) => sql<
      {
        status: "applied" | "failed";
        at: Date;
        last_name: string | null;
        first_name: string | null;
        add_count: number;
        change_count: number;
        message: string | null;
      }[]
    >`
      select b.status, coalesce(b.applied_at, b.updated_at) as at, e.last_name, e.first_name, b.add_count, b.change_count,
             b.message
      from import_batches b left join employees e on e.id = b.applied_by
      where b.kind = ${kind} and b.status in ('applied', 'failed')
      order by coalesce(b.applied_at, b.updated_at) desc limit 1`
  );
  const r = rows[0];
  if (!r) return null;
  return {
    status: r.status,
    at: r.at,
    byName: r.last_name ? `${r.last_name}${r.first_name ? ` ${r.first_name}` : ""}` : null,
    addCount: r.add_count,
    changeCount: r.change_count,
    message: r.message,
  };
};

export type OrderItemDetail = {
  lineNo: number;
  productCode: string;
  productId: string | null;
  productName: string;
  optionText: string | null;
  hasCustomization: boolean;
  customizationText: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type OrderDetail = OrderSummary & {
  customerPhoneDigits: string | null;
  shipName: string;
  shipPostalCode: string | null;
  shipPrefecture: string | null;
  shipAddress1: string | null;
  shipAddress2: string | null;
  shipPhone: string | null;
  paymentMethod: string | null;
  paymentStatus: PaymentStatus;
  requestedDeliveryDate: string | null;
  customerNote: string | null;
  subtotal: number;
  shippingFee: number;
  discount: number;
  tax: number;
  rawRow: unknown;
  // 最後に取り込んだ日時
  updatedAt: Date;
  items: OrderItemDetail[];
};

// EV-02・EV-08 注文と明細(D-06・B-02 も使う)。無ければ null
export const getOrderWithItems = async (orderId: string): Promise<OrderDetail | null> => {
  if (!UUID_PATTERN.test(orderId)) return null;
  const rows = await query(
    (sql) => sql<
      (OrderSummaryRow & {
        customer_phone_digits: string | null;
        ship_name: string;
        ship_postal_code: string | null;
        ship_prefecture: string | null;
        ship_address1: string | null;
        ship_address2: string | null;
        ship_phone: string | null;
        payment_method: string | null;
        payment_status: PaymentStatus;
        requested_delivery_date: string | null;
        customer_note: string | null;
        subtotal: number;
        shipping_fee: number;
        discount: number;
        tax: number;
        raw_row: unknown;
        updated_at: Date;
      })[]
    >`
      select ${SUMMARY_COLUMNS(sql)}, o.customer_phone_digits, o.ship_name, o.ship_postal_code, o.ship_prefecture,
             o.ship_address1, o.ship_address2, o.ship_phone, o.payment_method, o.payment_status,
             to_char(o.requested_delivery_date, 'YYYY-MM-DD') as requested_delivery_date, o.customer_note,
             o.subtotal, o.shipping_fee, o.discount, o.tax, o.raw_row, o.updated_at
      from orders o where o.id = ${orderId}`
  );
  const r = rows[0];
  if (!r) return null;
  const items = await query(
    (sql) => sql<
      {
        line_no: number;
        product_code: string;
        product_id: string | null;
        product_name: string;
        option_text: string | null;
        has_customization: boolean;
        customization_text: string | null;
        quantity: number;
        unit_price: number;
        amount: number;
      }[]
    >`
      select line_no, product_code, product_id, product_name, option_text, has_customization, customization_text,
             quantity, unit_price, amount
      from order_items where order_id = ${orderId} order by line_no`
  );
  return {
    ...toSummary(r),
    customerPhoneDigits: r.customer_phone_digits,
    shipName: r.ship_name,
    shipPostalCode: r.ship_postal_code,
    shipPrefecture: r.ship_prefecture,
    shipAddress1: r.ship_address1,
    shipAddress2: r.ship_address2,
    shipPhone: r.ship_phone,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    requestedDeliveryDate: r.requested_delivery_date,
    customerNote: r.customer_note,
    subtotal: r.subtotal,
    shippingFee: r.shipping_fee,
    discount: r.discount,
    tax: r.tax,
    rawRow: r.raw_row,
    updatedAt: r.updated_at,
    items: items.map((i) => ({
      lineNo: i.line_no,
      productCode: i.product_code,
      productId: i.product_id,
      productName: i.product_name,
      optionText: i.option_text,
      hasCustomization: i.has_customization,
      customizationText: i.customization_text,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      amount: i.amount,
    })),
  };
};

// ---- ほかの機能が使う関数(EV-08) ----

export type FindOrdersInput = {
  shopOrderNo?: string;
  crossmallOrderNo?: string;
  name?: string;
  email?: string;
  phone?: string;
  // 注文日の期間(日本時間の "YYYY-MM-DD"。to はその日を含む)
  from?: string;
  to?: string;
  limit?: number;
};

// D-06 注文を探す。渡した条件はすべて満たすもの(AND)。新しい順に最大 limit 件(既定20)。
// 注文番号・電話はハイフン・空白・全角半角の違いを、名前はひらがな・カタカナ・空白の違いを無視する(CH-13)
export const findOrders = async (input: FindOrdersInput): Promise<OrderSummary[]> => {
  const limit = Math.min(Math.max(1, Math.floor(input.limit ?? FIND_ORDERS_DEFAULT_LIMIT)), 100);
  const email = input.email !== undefined ? normalizeEmail(input.email) : undefined;
  const digits = input.phone !== undefined ? phoneDigits(input.phone) : undefined;
  // 空の条件(整えると空になるもの)が渡されたときは、何も返さない(全件を返さないため)
  if (
    (input.shopOrderNo !== undefined && !normalizeOrderNo(input.shopOrderNo)) ||
    (input.crossmallOrderNo !== undefined && !normalizeOrderNo(input.crossmallOrderNo)) ||
    (input.name !== undefined && !normalizeName(input.name)) ||
    email === null ||
    digits === null
  )
    return [];
  const rows = await query(
    (sql) => sql<OrderSummaryRow[]>`
      select ${SUMMARY_COLUMNS(sql)} from orders o
      where true
        ${input.crossmallOrderNo !== undefined ? sql`and ${orderNoMatch(sql, "crossmall_order_no", input.crossmallOrderNo)}` : sql``}
        ${input.shopOrderNo !== undefined ? sql`and ${orderNoMatch(sql, "shop_order_no", input.shopOrderNo)}` : sql``}
        ${email ? sql`and o.customer_email = ${email}` : sql``}
        ${digits ? sql`and o.customer_phone_digits = ${digits}` : sql``}
        ${input.name !== undefined ? sql`and ${nameMatch(sql, input.name)}` : sql``}
        ${periodMatch(sql, input.from, input.to)}
      order by o.ordered_at desc limit ${limit}`
  );
  return rows.map(toSummary);
};

export type ShipmentCount = {
  productId: string | null;
  productCode: string;
  // 出荷の回数(注文の数)と数量
  orderCount: number;
  quantity: number;
};

// B-04・A-03 商品ごとの出荷の回数と数量(キャンセルを除く)。
// 【仮】期間は注文日(日本時間)で数える(出荷日が CSV にあるか分からないため。00_仮決め一覧 B-01-仮-15)
export const getShipmentCounts = async (from: string, to: string): Promise<ShipmentCount[]> => {
  const rows = await query(
    (sql) => sql<{ product_id: string | null; product_code: string; order_count: number; quantity: string }[]>`
      select i.product_id, i.product_code, count(distinct o.id)::int as order_count, sum(i.quantity)::bigint as quantity
      from order_items i join orders o on o.id = i.order_id
      where not o.is_cancelled ${periodMatch(sql, from, to)}
      group by i.product_id, i.product_code
      order by i.product_code`
  );
  return rows.map((r) => ({
    productId: r.product_id,
    productCode: r.product_code,
    orderCount: r.order_count,
    quantity: Number(r.quantity),
  }));
};
