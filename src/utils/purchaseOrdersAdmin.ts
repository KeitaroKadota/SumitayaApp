// 発注の画面(A-03 G05〜G07)の読み書き(03 EV-08・EV-09・EV-12〜EV-16、04 CH-08・CH-09・CH-11〜CH-13)。
// ほかの機能が使う関数は purchaseOrders.ts、金額の計算・状態の決まりは purchaseOrderRules.ts。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("sales", …) 済みの前提)。
import { query, transaction } from "@/utils/db";
import type { Rounding } from "@/utils/invoices";
import { FORECAST_DEFAULTS } from "@/utils/forecast";
import {
  ORDER_DATE_PAST_DAYS,
  PO_LIMITS,
  PO_STATUSES,
  calcPoTotals,
  canOperate,
  formatPoNo,
  isPoStatus,
  isSendMethod,
  type PoStatus,
  type SendMethod,
} from "@/utils/purchaseOrderRules";
import { normalizeProductCode } from "@/utils/productRules";
import { addDays } from "@/utils/salesPeriod";
import { isValidDateStr, toHalfWidth } from "@/utils/textNormalize";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PO_PAGE_SIZE = 50;

// ---- EV-16 発注の一覧(G05) ----

// 状態の絞り込み: open(未完了: 下書き〜一部入荷)・all・各状態
export type PoListFilter = { status: "open" | "all" | PoStatus; supplierId: string; from: string; to: string; page: number };

export type PoListRow = {
  id: string;
  orderNo: string;
  supplierName: string;
  status: PoStatus;
  lineCount: number;
  subtotal: number;
  orderDate: string | null;
  expectedDate: string | null;
  createdByName: string | null;
};

export const parsePoListFilter = (params: Record<string, string | string[] | undefined>): PoListFilter => {
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).trim() : "");
  const status = str("status");
  const page = Number(str("page"));
  return {
    status: status === "all" || isPoStatus(status) ? status : "open",
    supplierId: UUID.test(str("supplier")) ? str("supplier") : "",
    from: isValidDateStr(str("from")) ? str("from") : "",
    to: isValidDateStr(str("to")) ? str("to") : "",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
};

export const listPurchaseOrders = async (f: PoListFilter): Promise<{ total: number; rows: PoListRow[] }> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        order_no: string;
        supplier_name: string;
        status: PoStatus;
        line_count: number;
        subtotal: number;
        order_date: string | null;
        expected_date: string | null;
        created_by_name: string | null;
        total: string;
      }[]
    >`
      select o.id, o.order_no, s.name as supplier_name, o.status,
             (select count(*)::int from purchase_order_lines l where l.purchase_order_id = o.id) as line_count,
             o.subtotal, o.order_date::text as order_date, o.expected_date::text as expected_date,
             case when e.id is null then null else e.last_name || ' ' || e.first_name end as created_by_name,
             count(*) over () as total
      from purchase_orders o
      join suppliers s on s.id = o.supplier_id
      left join employees e on e.id = o.created_by
      where true
        ${f.status === "open" ? sql`and o.status in ('draft', 'ordered', 'partially_received')` : f.status === "all" ? sql`` : sql`and o.status = ${f.status}`}
        ${f.supplierId ? sql`and o.supplier_id = ${f.supplierId}` : sql``}
        ${f.from ? sql`and coalesce(o.order_date, (o.created_at at time zone 'Asia/Tokyo')::date) >= ${f.from}::date` : sql``}
        ${f.to ? sql`and coalesce(o.order_date, (o.created_at at time zone 'Asia/Tokyo')::date) <= ${f.to}::date` : sql``}
      order by o.created_at desc
      limit ${PO_PAGE_SIZE} offset ${(f.page - 1) * PO_PAGE_SIZE}`
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      orderNo: r.order_no,
      supplierName: r.supplier_name,
      status: r.status,
      lineCount: r.line_count,
      subtotal: r.subtotal,
      orderDate: r.order_date,
      expectedDate: r.expected_date,
      createdByName: r.created_by_name,
    })),
  };
};

// ---- EV-08 手で発注を作る ----

export const createManualDraft = async (supplierId: string, by: string): Promise<string | null> => {
  if (!UUID.test(supplierId)) return null;
  return transaction(async (tx) => {
    const [s] = await tx<{ id: string }[]>`select id from suppliers where id = ${supplierId} and is_active`;
    if (!s) return null;
    const [seq] = await tx<{ n: string }[]>`select nextval('purchase_order_no_seq') as n`;
    const [po] = await tx<{ id: string }[]>`
      insert into purchase_orders (order_no, supplier_id, status, source, created_by, updated_by)
      values (${formatPoNo(Number(seq.n))}, ${supplierId}, 'draft', 'manual', ${by}, ${by}) returning id`;
    return po.id;
  });
};

// ---- G06 発注の詳細 ----

export type PoDetailLine = {
  id: string;
  lineNo: number;
  productId: string;
  productCode: string;
  supplierItemCode: string | null;
  productName: string;
  suggestedQty: number | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
  receivedQty: number;
};

export type PoDetail = {
  id: string;
  orderNo: string;
  status: PoStatus;
  source: "suggestion" | "manual";
  runCreatedAt: Date | null;
  supplier: {
    id: string;
    name: string;
    postalCode: string | null;
    address: string | null;
    phone: string | null;
    fax: string | null;
    email: string | null;
    orderMethod: string | null;
    leadTimeDays: number | null;
  };
  orderDate: string | null;
  expectedDate: string | null;
  sendMethod: SendMethod | null;
  subtotal: number;
  tax: number;
  total: number;
  note: string | null;
  internalNote: string | null;
  createdAt: Date;
  createdByName: string | null;
  orderedAt: Date | null;
  orderedByName: string | null;
  closedAt: Date | null;
  closedByName: string | null;
  cancelledAt: Date | null;
  cancelledByName: string | null;
  lines: PoDetailLine[];
};

export const getPurchaseOrder = async (id: string): Promise<PoDetail | null> => {
  if (!UUID.test(id)) return null;
  const [o] = await query(
    (sql) => sql<
      {
        id: string;
        order_no: string;
        status: PoStatus;
        source: "suggestion" | "manual";
        run_created_at: Date | null;
        supplier_id: string;
        supplier_name: string;
        postal_code: string | null;
        address: string | null;
        phone: string | null;
        fax: string | null;
        email: string | null;
        order_method: string | null;
        lead_time_days: number | null;
        order_date: string | null;
        expected_date: string | null;
        send_method: SendMethod | null;
        subtotal: number;
        tax: number;
        total: number;
        note: string | null;
        internal_note: string | null;
        created_at: Date;
        created_by_name: string | null;
        ordered_at: Date | null;
        ordered_by_name: string | null;
        closed_at: Date | null;
        closed_by_name: string | null;
        cancelled_at: Date | null;
        cancelled_by_name: string | null;
      }[]
    >`
      select o.id, o.order_no, o.status, o.source, r.created_at as run_created_at, o.supplier_id, s.name as supplier_name,
             s.postal_code, s.address, s.phone, s.fax, s.email, s.order_method, s.lead_time_days,
             o.order_date::text as order_date, o.expected_date::text as expected_date, o.send_method, o.subtotal, o.tax, o.total,
             o.note, o.internal_note, o.created_at, case when ce.id is null then null else ce.last_name || ' ' || ce.first_name end as created_by_name,
             o.ordered_at, case when oe.id is null then null else oe.last_name || ' ' || oe.first_name end as ordered_by_name, o.closed_at, case when le.id is null then null else le.last_name || ' ' || le.first_name end as closed_by_name,
             o.cancelled_at, case when xe.id is null then null else xe.last_name || ' ' || xe.first_name end as cancelled_by_name
      from purchase_orders o
      join suppliers s on s.id = o.supplier_id
      left join analysis_runs r on r.id = o.run_id
      left join employees ce on ce.id = o.created_by
      left join employees oe on oe.id = o.ordered_by
      left join employees le on le.id = o.closed_by
      left join employees xe on xe.id = o.cancelled_by
      where o.id = ${id}`
  );
  if (!o) return null;
  const lines = await query(
    (sql) => sql<
      {
        id: string;
        line_no: number;
        product_id: string;
        product_code: string;
        supplier_item_code: string | null;
        product_name: string;
        suggested_qty: number | null;
        quantity: number;
        unit_price: number;
        tax_rate: number;
        amount: number;
        received_qty: number;
      }[]
    >`
      select l.id, l.line_no, l.product_id, p.product_code, l.supplier_item_code, l.product_name, l.suggested_qty, l.quantity,
             l.unit_price, l.tax_rate, l.amount, l.received_qty
      from purchase_order_lines l join products p on p.id = l.product_id
      where l.purchase_order_id = ${id} order by l.line_no`
  );
  return {
    id: o.id,
    orderNo: o.order_no,
    status: o.status,
    source: o.source,
    runCreatedAt: o.run_created_at,
    supplier: {
      id: o.supplier_id,
      name: o.supplier_name,
      postalCode: o.postal_code,
      address: o.address,
      phone: o.phone,
      fax: o.fax,
      email: o.email,
      orderMethod: o.order_method,
      leadTimeDays: o.lead_time_days,
    },
    orderDate: o.order_date,
    expectedDate: o.expected_date,
    sendMethod: o.send_method,
    subtotal: o.subtotal,
    tax: o.tax,
    total: o.total,
    note: o.note,
    internalNote: o.internal_note,
    createdAt: o.created_at,
    createdByName: o.created_by_name,
    orderedAt: o.ordered_at,
    orderedByName: o.ordered_by_name,
    closedAt: o.closed_at,
    closedByName: o.closed_by_name,
    cancelledAt: o.cancelled_at,
    cancelledByName: o.cancelled_by_name,
    lines: lines.map((l) => ({
      id: l.id,
      lineNo: l.line_no,
      productId: l.product_id,
      productCode: l.product_code,
      supplierItemCode: l.supplier_item_code,
      productName: l.product_name,
      suggestedQty: l.suggested_qty,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      taxRate: l.tax_rate,
      amount: l.amount,
      receivedQty: l.received_qty,
    })),
  };
};

// 入荷予定日の既定(発注日＋リードタイム。仕入先 → 定数の既定)
export const defaultExpectedDate = (po: PoDetail, orderDate: string): string =>
  addDays(orderDate, po.supplier.leadTimeDays ?? FORECAST_DEFAULTS.defaultLeadTimeDays);

// CH-13 仕入先の連絡先(発注方法が FAX なら FAX 番号、メールならメールアドレス)。無ければ警告の文
export const supplierContactWarning = (po: PoDetail): string | null => {
  if (po.supplier.orderMethod === "fax" && !po.supplier.fax) return "仕入先の FAX が登録されていません";
  if (po.supplier.orderMethod === "email" && !po.supplier.email) return "仕入先のメールが登録されていません";
  if (!po.supplier.fax && !po.supplier.email) return "仕入先の FAX・メールが登録されていません";
  return null;
};

// ---- EV-09 下書きの保存 ----

export type DraftLineInput = { lineId: string; quantity: string; unitPrice: string; remove: boolean };
export type DraftInput = {
  lines: DraftLineInput[];
  // 足す行(商品コード・数・単価)
  addCode: string;
  addQuantity: string;
  addUnitPrice: string;
  expectedDate: string;
  note: string;
  internalNote: string;
};

export type SaveDraftResult = { ok: true; warnings: string[] } | { ok: false; errors: Record<string, string>; formError: string | null };

const parseInt0 = (v: string, max: number): number | null => {
  const s = toHalfWidth(v).replace(/[,，円¥￥\s]/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= max ? n : null;
};

export const saveDraft = async (id: string, input: DraftInput, rounding: Rounding, today: string, by: string): Promise<SaveDraftResult> => {
  const po = await getPurchaseOrder(id);
  if (!po) return { ok: false, errors: {}, formError: "この発注は見つかりません。" };
  // CH-09
  if (!canOperate(po.status, "save")) return { ok: false, errors: {}, formError: "下書きではないので直せません" };

  // CH-08 明細の入力
  const errors: Record<string, string> = {};
  const kept: { id: string; quantity: number; unitPrice: number; productId: string; productCode: string; suggestedQty: number | null }[] = [];
  const removed: string[] = [];
  for (const l of po.lines) {
    const inp = input.lines.find((x) => x.lineId === l.id);
    if (!inp) {
      kept.push({ id: l.id, quantity: l.quantity, unitPrice: l.unitPrice, productId: l.productId, productCode: l.productCode, suggestedQty: l.suggestedQty });
      continue;
    }
    if (inp.remove) {
      removed.push(l.id);
      continue;
    }
    const qty = parseInt0(inp.quantity, PO_LIMITS.maxQty);
    const price = parseInt0(inp.unitPrice, PO_LIMITS.maxUnitPrice);
    if (qty === null || qty < 1) errors[`qty_${l.id}`] = `${l.lineNo}行目: 発注数は1〜99,999の整数で入力してください。`;
    if (price === null) errors[`price_${l.id}`] = `${l.lineNo}行目: 単価は0〜9,999,999の整数で入力してください。`;
    kept.push({ id: l.id, quantity: qty ?? 0, unitPrice: price ?? 0, productId: l.productId, productCode: l.productCode, suggestedQty: l.suggestedQty });
  }

  // 足す行(手で足した行の税率・既定の単価は商品マスタから)
  let added: { productId: string; productCode: string; name: string; quantity: number; unitPrice: number; taxRate: number } | null = null;
  const addCode = normalizeProductCode(input.addCode);
  if (addCode) {
    const [p] = await query(
      (sql) => sql<{ id: string; product_code: string; name: string; cost_price: number | null; tax_rate: number; is_active: boolean }[]>`
        select id, product_code, name, cost_price, tax_rate, is_active from products where product_code = ${addCode}`
    );
    if (!p || !p.is_active) errors.add_code = "商品マスタにある使用中の商品コードを入力してください。";
    else if (kept.some((k) => k.productId === p.id)) errors.add_code = "同じ商品は1つの発注に1行だけです。";
    const qty = parseInt0(input.addQuantity, PO_LIMITS.maxQty);
    if (qty === null || qty < 1) errors.add_quantity = "発注数は1〜99,999の整数で入力してください。";
    const price = input.addUnitPrice.trim() === "" ? (p?.cost_price ?? 0) : parseInt0(input.addUnitPrice, PO_LIMITS.maxUnitPrice);
    if (price === null) errors.add_unit_price = "単価は0〜9,999,999の整数で入力してください。";
    if (p && !errors.add_code && qty && price !== null)
      added = { productId: p.id, productCode: p.product_code, name: p.name, quantity: qty, unitPrice: price, taxRate: p.tax_rate };
  }

  const expected = input.expectedDate.trim();
  if (expected && (!isValidDateStr(expected) || expected < (po.orderDate ?? today)))
    errors.expected_date = "入荷予定日は発注日（無ければ今日）以後の日付にしてください。";
  if (input.note.length > PO_LIMITS.maxNote) errors.note = "仕入先への連絡は500文字以内で入力してください。";
  if (input.internalNote.length > PO_LIMITS.maxNote) errors.internal_note = "社内のメモは500文字以内で入力してください。";
  if (Object.keys(errors).length > 0) return { ok: false, errors, formError: null };

  // 警告: CH-08 提案の数と大きく違う、CH-11 同じ商品の発注が残っている
  const warnings: string[] = [];
  for (const k of kept)
    if (k.suggestedQty && (k.quantity > k.suggestedQty * 2 || k.quantity < k.suggestedQty / 2))
      warnings.push(`${k.productCode}: 提案の数（${k.suggestedQty}）と大きく違います`);
  const allProducts = [...kept.map((k) => ({ id: k.productId, code: k.productCode })), ...(added ? [{ id: added.productId, code: added.productCode }] : [])];
  if (allProducts.length > 0) {
    const others = await query(
      (sql) => sql<{ product_id: string; order_no: string; status: PoStatus; open_qty: number }[]>`
        select l.product_id, o.order_no, o.status, greatest(l.quantity - l.received_qty, 0)::int as open_qty
        from purchase_order_lines l join purchase_orders o on o.id = l.purchase_order_id
        where o.id <> ${id} and o.status in ('draft', 'ordered', 'partially_received')
          and l.product_id = any(${allProducts.map((p) => p.id)}::uuid[])`
    );
    for (const o of others) {
      const code = allProducts.find((p) => p.id === o.product_id)?.code ?? "";
      warnings.push(`${code} は ${o.order_no}（${PO_STATUSES[o.status]}・残り ${o.open_qty}）にもあります`);
    }
  }

  // 手順4・5 トランザクションで: 明細の追加・変更・削除、金額、入荷予定日・連絡・メモ。消した明細の提案は FK(on delete set null)で空に戻る
  const taxOf = new Map(po.lines.map((l) => [l.id, l.taxRate]));
  const finalLines = [
    ...kept.map((k) => ({ quantity: k.quantity, unitPrice: k.unitPrice, taxRate: taxOf.get(k.id) ?? 10 })),
    ...(added ? [{ quantity: added.quantity, unitPrice: added.unitPrice, taxRate: added.taxRate }] : []),
  ];
  const totals = calcPoTotals(finalLines, rounding);
  const saved = await transaction(async (tx) => {
    const [locked] = await tx<{ status: PoStatus }[]>`select status from purchase_orders where id = ${id} for update`;
    if (!locked || !canOperate(locked.status, "save")) return false;
    if (removed.length > 0) await tx`delete from purchase_order_lines where id = any(${removed}::uuid[]) and purchase_order_id = ${id}`;
    for (const k of kept)
      await tx`
        update purchase_order_lines set quantity = ${k.quantity}, unit_price = ${k.unitPrice}, amount = ${k.quantity * k.unitPrice}
        where id = ${k.id} and purchase_order_id = ${id}`;
    if (added) {
      const [next] = await tx<{ n: number }[]>`select coalesce(max(line_no), 0)::int + 1 as n from purchase_order_lines where purchase_order_id = ${id}`;
      await tx`
        insert into purchase_order_lines (purchase_order_id, line_no, product_id, product_name, quantity, unit_price, tax_rate, amount)
        values (${id}, ${next.n}, ${added.productId}, ${added.name}, ${added.quantity}, ${added.unitPrice}, ${added.taxRate},
                ${added.quantity * added.unitPrice})`;
    }
    await tx`
      update purchase_orders set subtotal = ${totals.subtotal}, tax = ${totals.tax}, total = ${totals.total},
        expected_date = ${expected || null}, note = ${input.note.trim() || null}, internal_note = ${input.internalNote.trim() || null},
        updated_by = ${by}
      where id = ${id}`;
    return true;
  });
  if (!saved) return { ok: false, errors: {}, formError: "下書きではないので直せません" };
  return { ok: true, warnings };
};

// ---- EV-13 「発注したことを記録」 ----

export type OrderInput = { orderDate: string; sendMethod: string; expectedDate: string };

export const markOrdered = async (
  id: string,
  input: OrderInput,
  today: string,
  by: string
): Promise<{ ok: true } | { ok: false; errors: Record<string, string>; formError: string | null }> => {
  // CH-12 発注日・方法・入荷予定日
  const errors: Record<string, string> = {};
  if (!isValidDateStr(input.orderDate) || input.orderDate > today || input.orderDate < addDays(today, -ORDER_DATE_PAST_DAYS))
    errors.order_date = "発注日は今日から30日前〜今日の日付にしてください。";
  if (!isSendMethod(input.sendMethod)) errors.send_method = "方法を選んでください。";
  if (!isValidDateStr(input.expectedDate) || (isValidDateStr(input.orderDate) && input.expectedDate < input.orderDate))
    errors.expected_date = "入荷予定日は発注日以後の日付にしてください。";
  if (Object.keys(errors).length > 0) return { ok: false, errors, formError: null };

  return transaction(async (tx) => {
    // CH-09 下書き → 発注済み(FOR UPDATE で読んでから)
    const [po] = await tx<{ status: PoStatus }[]>`select status from purchase_orders where id = ${id} for update`;
    if (!po || !canOperate(po.status, "order")) return { ok: false as const, errors: {}, formError: "下書きではないので記録できません" };
    // CH-08 明細が1行以上・単価0の行が無い
    const [agg] = await tx<{ n: number; zero: number }[]>`
      select count(*)::int as n, count(*) filter (where unit_price = 0)::int as zero from purchase_order_lines where purchase_order_id = ${id}`;
    if (!agg || agg.n === 0) return { ok: false as const, errors: {}, formError: "明細を1行以上入れてください" };
    if (agg.zero > 0) return { ok: false as const, errors: {}, formError: "単価が0の行があります。単価を入れて保存してから記録してください" };
    await tx`
      update purchase_orders set status = 'ordered', order_date = ${input.orderDate}, send_method = ${input.sendMethod},
        expected_date = ${input.expectedDate}, ordered_by = ${by}, ordered_at = now(), updated_by = ${by}
      where id = ${id}`;
    return { ok: true as const };
  });
};

// ---- EV-14 取消・EV-15 残りを打ち切る ----

export const cancelDraft = async (id: string, by: string): Promise<boolean> =>
  transaction(async (tx) => {
    const [po] = await tx<{ status: PoStatus }[]>`select status from purchase_orders where id = ${id} for update`;
    if (!po || !canOperate(po.status, "cancel")) return false;
    await tx`update purchase_orders set status = 'cancelled', cancelled_by = ${by}, cancelled_at = now(), updated_by = ${by} where id = ${id}`;
    // 結び付いた提案を、また選べるようにする
    await tx`
      update replenishment_suggestions set purchase_order_line_id = null
      where purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id = ${id})`;
    return true;
  });

export const closeOrder = async (id: string, by: string): Promise<boolean> =>
  transaction(async (tx) => {
    const [po] = await tx<{ status: PoStatus }[]>`select status from purchase_orders where id = ${id} for update`;
    if (!po || !canOperate(po.status, "close")) return false;
    await tx`update purchase_orders set status = 'closed', closed_by = ${by}, closed_at = now(), updated_by = ${by} where id = ${id}`;
    return true;
  });

// 仕入先の選択肢(EV-08 の小窓)
export const listSupplierOptions = async (): Promise<{ id: string; name: string }[]> =>
  query((sql) => sql<{ id: string; name: string }[]>`select id, name from suppliers where is_active order by name_kana nulls last, name`);
