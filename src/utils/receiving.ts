// C-02 発注との照合・検収のDBの読み書き(03 EV-01〜EV-05・EV-08・EV-09、04 CH-01・CH-02・CH-07・CH-08)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("purchasing") を済ませている前提。C-01 の確定からも呼ぶ)。
// 照合の計算は receivingMatch.ts。発注の入荷済みの数と状態は A-03 の recordReceipt・cancelReceipt に書いてもらう
// (C-02 は発注のテーブルに直接書かない。01 6.2)。
// 【仮】B-03(在庫の増減の記録 inventory_movements・recordMovement)がまだ無いので、検収で在庫の記録は作らない。
// movement_id は空のまま(00_仮決め一覧 C-02-仮-11。B-03 を作るときに acceptSlip・cancelAcceptance に足す)。
import { query, transaction, type SqlLike } from "@/utils/db";
import { formatDateShort } from "@/utils/format";
import { addBusinessDays } from "@/utils/holidays";
import { todayJST } from "@/utils/jst";
import { cancelReceipt, findOpenPurchaseOrders, getPurchaseOrderLines, recordReceipt, type OpenPurchaseOrderLine } from "@/utils/purchaseOrders";
import { OPEN_PO_STATUSES, type PoStatus } from "@/utils/purchaseOrderRules";
import {
  RECEIVING_RULES,
  canAutoAccept,
  isWithinCancelWindow,
  matchLines,
  pickPurchaseOrder,
  reviewReasonsOf,
  type MatchPo,
  type MatchResult,
  type MatchSlipLine,
  type MatchStatus,
} from "@/utils/receivingMatch";
import { completeTasksBySource, createTask } from "@/utils/tasks";
import type { SlipStatus } from "@/utils/deliverySlipRules";

export const RECEIVING_FEATURE_ID = "C-02";
export const RECEIVING_TASK_TYPE = "receiving_check";
export const RECEIVING_URL = "/admin/purchasing/receiving";
export const receivingUrl = (slipId: string) => `/admin/purchasing/slips/${encodeURIComponent(slipId)}/receiving`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_PATTERN.test(v);

// ---- 読み取り ----

export type ReceivingSlip = {
  id: string;
  status: SlipStatus;
  fileIds: string[];
  supplierId: string | null;
  supplierName: string | null;
  slipNo: string | null;
  deliveryDate: string | null;
  orderRef: string | null;
  taxIncluded: boolean;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  needsCheck: boolean;
  purchaseOrderId: string | null;
  purchaseOrderNo: string | null;
  matchStatus: MatchStatus | null;
  reviewReasons: string[];
  matchedAt: Date | null;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  acceptNote: string | null;
  receivedInvoiceId: string | null;
  // ほかの人の更新を見るための updated_at(C-01 と同じ作り)
  version: string;
};

type SlipRow = {
  id: string;
  status: SlipStatus;
  file_ids: string[];
  supplier_id: string | null;
  supplier_name: string | null;
  slip_no: string | null;
  delivery_date: string | null;
  order_ref: string | null;
  tax_included: boolean;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  needs_check: boolean;
  purchase_order_id: string | null;
  purchase_order_no: string | null;
  match_status: MatchStatus | null;
  review_reasons: unknown;
  matched_at: Date | null;
  accepted_at: Date | null;
  accepted_by_name: string | null;
  accept_note: string | null;
  received_invoice_id: string | null;
  version: string;
};

const SELECT_SLIP = (sql: SqlLike) => sql`
  select d.id, d.status, d.file_ids, d.supplier_id, s.name as supplier_name, d.slip_no,
         to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date, d.order_ref, d.tax_included, d.subtotal, d.tax, d.total,
         d.needs_check, d.purchase_order_id, o.order_no as purchase_order_no, d.match_status, d.review_reasons, d.matched_at,
         d.accepted_at, case when a.id is null then null else a.last_name || ' ' || a.first_name end as accepted_by_name,
         d.accept_note, d.received_invoice_id, (extract(epoch from d.updated_at) * 1000000)::bigint::text as version
  from delivery_slips d
  left join suppliers s on s.id = d.supplier_id
  left join purchase_orders o on o.id = d.purchase_order_id
  left join employees a on a.id = d.accepted_by`;

const toSlip = (r: SlipRow): ReceivingSlip => ({
  id: r.id,
  status: r.status,
  fileIds: r.file_ids,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  slipNo: r.slip_no,
  deliveryDate: r.delivery_date,
  orderRef: r.order_ref,
  taxIncluded: r.tax_included,
  subtotal: r.subtotal,
  tax: r.tax,
  total: r.total,
  needsCheck: r.needs_check,
  purchaseOrderId: r.purchase_order_id,
  purchaseOrderNo: r.purchase_order_no,
  matchStatus: r.match_status,
  reviewReasons: Array.isArray(r.review_reasons) ? r.review_reasons.filter((x): x is string => typeof x === "string") : [],
  matchedAt: r.matched_at,
  acceptedAt: r.accepted_at,
  acceptedByName: r.accepted_by_name,
  acceptNote: r.accept_note,
  receivedInvoiceId: r.received_invoice_id,
  version: r.version,
});

export const getReceivingSlip = async (id: string): Promise<ReceivingSlip | null> => {
  if (!isUuid(id)) return null;
  const [row] = await query((sql) => sql<SlipRow[]>`${SELECT_SLIP(sql)} where d.id = ${id}`);
  return row ? toSlip(row) : null;
};

export type ReceivingLine = MatchSlipLine & {
  supplierItemCode: string | null;
  itemName: string;
  spec: string | null;
  unit: string | null;
  unitPrice: number | null;
  productCode: string | null;
  productName: string | null;
  purchaseOrderLineId: string | null;
  matchResult: MatchResult | null;
  unitsQuantity: number | null;
  expectedQuantity: number | null;
  expectedUnitPrice: number | null;
  acceptedQuantity: number | null;
};

// 明細と、入数(対応表の pack_quantity。使っている対応が無ければ1)・商品の税率
export const getReceivingLines = async (slipId: string): Promise<ReceivingLine[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        line_no: number;
        supplier_item_code: string | null;
        item_name: string;
        spec: string | null;
        quantity: number | null;
        unit: string | null;
        unit_price: number | null;
        amount: number | null;
        product_id: string | null;
        product_code: string | null;
        product_name: string | null;
        is_non_stock: boolean;
        pack_quantity: number;
        tax_rate: number;
        purchase_order_line_id: string | null;
        match_result: MatchResult | null;
        units_quantity: number | null;
        expected_quantity: number | null;
        expected_unit_price: number | null;
        accepted_quantity: number | null;
      }[]
    >`
      select l.id, l.line_no, l.supplier_item_code, l.item_name, l.spec, l.quantity::float8 as quantity, l.unit, l.unit_price,
             l.amount, l.product_id, p.product_code, p.name as product_name, l.is_non_stock,
             coalesce(c.pack_quantity, 1) as pack_quantity, coalesce(p.tax_rate, 10)::int as tax_rate,
             l.purchase_order_line_id, l.match_result, l.units_quantity::float8 as units_quantity, l.expected_quantity,
             l.expected_unit_price, l.accepted_quantity
      from delivery_slip_lines l
      join delivery_slips d on d.id = l.slip_id
      left join products p on p.id = l.product_id
      left join supplier_item_codes c
        on c.supplier_id = d.supplier_id and c.supplier_item_code = l.supplier_item_code and c.is_active
      where l.slip_id = ${slipId}
      order by l.line_no`
  );
  return rows.map((r) => ({
    id: r.id,
    lineNo: r.line_no,
    supplierItemCode: r.supplier_item_code,
    itemName: r.item_name,
    spec: r.spec,
    quantity: r.quantity,
    unit: r.unit,
    unitPrice: r.unit_price,
    amount: r.amount,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    isNonStock: r.is_non_stock,
    packQuantity: r.pack_quantity,
    taxRate: r.tax_rate,
    purchaseOrderLineId: r.purchase_order_line_id,
    matchResult: r.match_result,
    unitsQuantity: r.units_quantity,
    expectedQuantity: r.expected_quantity,
    expectedUnitPrice: r.expected_unit_price,
    acceptedQuantity: r.accepted_quantity,
  }));
};

const toMatchPo = (po: { id: string; orderNo: string; expectedDate: string | null; orderDate: string | null; lines: OpenPurchaseOrderLine[] }): MatchPo => ({
  id: po.id,
  orderNo: po.orderNo,
  expectedDate: po.expectedDate,
  orderDate: po.orderDate,
  lines: po.lines.map((l) => ({ id: l.id, lineNo: l.lineNo, productId: l.productId, unitPrice: l.unitPrice, openQty: l.openQty })),
});

// ---- EV-01 照合する ----

export type MatchOutcome =
  | { ok: true; status: "accepted" | "needs_review" }
  | { ok: false; reason: "not_found" | "status" | "po" };

// allowAuto: 一致したら自動で検収してよいか(C-01 の確定から呼ぶときだけ true。人が発注を選んだとき・画面を開いたときは false)
export const matchSlip = async (
  slipId: string,
  { by, chosenPurchaseOrderId = null, allowAuto }: { by: string | null; chosenPurchaseOrderId?: string | null; allowAuto: boolean }
): Promise<MatchOutcome> => {
  // 手順1: CH-01
  const slip = await getReceivingSlip(slipId);
  if (!slip) return { ok: false, reason: "not_found" };
  if ((slip.status !== "confirmed" && slip.status !== "needs_review") || !slip.supplierId) return { ok: false, reason: "status" };
  // 手順2
  const lines = await getReceivingLines(slipId);
  // 手順3: 発注を選ぶ(5.1)。人が選んだ発注は CH-02(同じ仕入先で ordered・partially_received)を満たすこと
  const candidates = (await findOpenPurchaseOrders({ supplierId: slip.supplierId })).map(toMatchPo);
  if (chosenPurchaseOrderId && !candidates.some((c) => c.id === chosenPurchaseOrderId)) return { ok: false, reason: "po" };
  const pick = pickPurchaseOrder({
    orderRef: slip.orderRef,
    deliveryDate: slip.deliveryDate,
    lines,
    candidates,
    chosenId: chosenPurchaseOrderId,
  });
  // 手順4・5: 明細ごとに比べる
  const matches = matchLines(lines, pick.po, slip.taxIncluded);
  // 手順6
  const reasons = reviewReasonsOf({ method: pick.method, matches, needsCheck: slip.needsCheck });

  const written = await transaction(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      update delivery_slips set purchase_order_id = ${pick.po?.id ?? null}, review_reasons = ${tx.json(reasons)},
             matched_at = now(), updated_by = ${by}
      where id = ${slipId} and status in ('confirmed', 'needs_review')
      returning id`;
    if (updated.length === 0) return false;
    for (const m of matches) {
      await tx`
        update delivery_slip_lines set purchase_order_line_id = ${m.purchaseOrderLineId}, match_result = ${m.result},
               units_quantity = ${m.unitsQuantity}, expected_quantity = ${m.expectedQuantity},
               expected_unit_price = ${m.expectedUnitPrice}, accepted_quantity = null
        where id = ${m.lineId} and slip_id = ${slipId}`;
    }
    return true;
  });
  if (!written) return { ok: false, reason: "status" };

  // 手順7: CH-06 自動で検収してよければ EV-03 を「自動」で呼ぶ(失敗したら要確認にする)
  if (allowAuto && canAutoAccept({ method: pick.method, matches, needsCheck: slip.needsCheck })) {
    const quantities = new Map(
      matches.filter((m) => m.result !== "non_stock").map((m) => [m.lineId, Math.max(0, Math.trunc(m.unitsQuantity ?? 0))])
    );
    const accepted = await acceptSlip(slipId, { mode: "auto", by: null, quantities, note: null });
    if (accepted.ok) return { ok: true, status: "accepted" };
    reasons.push("自動の検収に失敗しました");
  }

  // 手順8: 要確認にする
  await query(
    (sql) => sql`
      update delivery_slips set status = 'needs_review', match_status = 'needs_review', review_reasons = ${sql.json(reasons)},
             updated_by = ${by}
      where id = ${slipId} and status in ('confirmed', 'needs_review')`
  );
  // 手順9: 確認のタスク(同じ納品書の未完了のタスクがあれば CMN-03 が上書きする。失敗しても照合の結果は残す)
  try {
    await issueReceivingTask(slip, reasons);
  } catch (e) {
    console.error("検収の確認のタスクを出せませんでした:", e instanceof Error ? e.message : e);
  }
  return { ok: true, status: "needs_review" };
};

// 01 7章: 件名「【検収の確認】〇〇織物 11/18（水） 伝票12345」、担当は機能キー purchasing を使える人、期限は翌営業日
const issueReceivingTask = async (slip: ReceivingSlip, reasons: string[]) => {
  const dueDate = await addBusinessDays(todayJST(), RECEIVING_RULES.taskDueBusinessDays);
  const title = [
    "【検収の確認】",
    slip.supplierName ?? "仕入先不明",
    slip.deliveryDate ? ` ${formatDateShort(slip.deliveryDate)}` : "",
    slip.slipNo ? ` 伝票${slip.slipNo}` : "",
  ].join("");
  const task = await createTask({
    type: RECEIVING_TASK_TYPE,
    title,
    body: reasons.length > 0 ? ["確認が必要な点:", ...reasons.map((r) => `・${r}`)].join("\n") : null,
    assigneeFeatureKey: "purchasing",
    dueDate,
    sourceFeature: RECEIVING_FEATURE_ID,
    sourceId: slip.id,
    linkUrl: receivingUrl(slip.id),
  });
  await query((sql) => sql`update delivery_slips set task_id = ${task.id} where id = ${slip.id}`);
};

// ---- EV-03 検収する・EV-04 発注なしで検収する ----

export type AcceptMode = "auto" | "reviewed" | "no_order";
export type AcceptOutcome = { ok: true } | { ok: false; reason: "status" | "conflict" | "po" | "error" };

class AcceptAbort extends Error {
  constructor(readonly reason: "status" | "conflict" | "po") {
    super(reason);
  }
}

// quantities: 明細ID → 受け入れる数(自社の単位・整数。CH-09 は呼ぶ側で確かめる)。version があれば、画面を開いたときのままか確かめる
export const acceptSlip = async (
  slipId: string,
  { mode, by, quantities, note, version }: { mode: AcceptMode; by: string | null; quantities: Map<string, number>; note: string | null; version?: string }
): Promise<AcceptOutcome> => {
  try {
    await transaction(async (tx) => {
      // CH-07 検収できる状態(別の人が先に検収していたら status)
      const [s] = await tx<{ status: SlipStatus; purchase_order_id: string | null; version: string }[]>`
        select status, purchase_order_id, (extract(epoch from updated_at) * 1000000)::bigint::text as version
        from delivery_slips where id = ${slipId} for update`;
      if (!s || (s.status !== "confirmed" && s.status !== "needs_review")) throw new AcceptAbort("status");
      if (version !== undefined && s.version !== version) throw new AcceptAbort("conflict");
      if (mode !== "no_order") {
        if (!s.purchase_order_id) throw new AcceptAbort("po");
        const [po] = await tx<{ status: PoStatus }[]>`select status from purchase_orders where id = ${s.purchase_order_id}`;
        if (!po || !OPEN_PO_STATUSES.includes(po.status)) throw new AcceptAbort("po");
      }
      const lines = await tx<{ id: string; is_non_stock: boolean; purchase_order_line_id: string | null }[]>`
        select id, is_non_stock, purchase_order_line_id from delivery_slip_lines where slip_id = ${slipId} order by line_no`;
      for (const l of lines) {
        if (l.is_non_stock) continue;
        const qty = quantities.get(l.id) ?? 0;
        // 3-1・3-2: 発注の入荷済みの数と状態は A-03 の recordReceipt が書く(0 の明細は呼ばない)
        if (mode !== "no_order" && qty > 0 && l.purchase_order_line_id) await recordReceipt(l.purchase_order_line_id, qty, tx);
        // 3-3: 【仮】B-03 が無いので在庫の記録(recordMovement)は作らない。3-4
        await tx`
          update delivery_slip_lines set accepted_quantity = ${qty}
                 ${mode === "no_order" ? tx`, purchase_order_line_id = null` : tx``}
          where id = ${l.id}`;
      }
      // 3-5
      const matchStatus: MatchStatus = mode === "auto" ? "auto_accepted" : mode === "no_order" ? "no_order" : "reviewed";
      await tx`
        update delivery_slips set status = 'accepted', match_status = ${matchStatus}, accepted_by = ${by}, accepted_at = now(),
               accept_note = ${note}, updated_by = ${by}
               ${mode === "no_order" ? tx`, purchase_order_id = null` : tx``}
        where id = ${slipId}`;
    });
  } catch (e) {
    if (e instanceof AcceptAbort) return { ok: false, reason: e.reason };
    console.error("納品書を検収できませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "error" };
  }
  // 手順4: タスクを閉じる(失敗しても検収は取り消さない)
  try {
    await completeTasksBySource(RECEIVING_FEATURE_ID, slipId, { types: [RECEIVING_TASK_TYPE] });
  } catch (e) {
    console.error("検収の確認のタスクを閉じられませんでした:", e instanceof Error ? e.message : e);
  }
  return { ok: true };
};

// ---- EV-08 検収を取り消す ----

export type CancelOutcome = { ok: true } | { ok: false; reason: "status" | "conflict" | "invoice" | "expired" | "error" };

class CancelAbort extends Error {
  constructor(readonly reason: "status" | "conflict" | "invoice" | "expired") {
    super(reason);
  }
}

// 発注の入荷済みの数を戻し(A-03 の cancelReceipt。【仮】C-02-仮-12)、納品書を確定(照合待ち)に戻して照合・検収の列を空にする。
// 【仮】取消の理由を残す列が無いので、accept_note に「【検収の取消】理由」として残す(次に検収したときに上書きされる。C-02-仮-13)
export const cancelAcceptance = async (slipId: string, version: string, reason: string, by: string): Promise<CancelOutcome> => {
  try {
    await transaction(async (tx) => {
      // CH-08
      const [s] = await tx<
        { status: SlipStatus; purchase_order_id: string | null; received_invoice_id: string | null; accepted_at: Date | null; version: string }[]
      >`
        select status, purchase_order_id, received_invoice_id, accepted_at,
               (extract(epoch from updated_at) * 1000000)::bigint::text as version
        from delivery_slips where id = ${slipId} for update`;
      if (!s || s.status !== "accepted") throw new CancelAbort("status");
      if (s.version !== version) throw new CancelAbort("conflict");
      if (s.received_invoice_id) throw new CancelAbort("invoice");
      if (!isWithinCancelWindow(s.accepted_at)) throw new CancelAbort("expired");
      if (s.purchase_order_id) {
        const lines = await tx<{ purchase_order_line_id: string; accepted_quantity: number }[]>`
          select purchase_order_line_id, accepted_quantity from delivery_slip_lines
          where slip_id = ${slipId} and purchase_order_line_id is not null and accepted_quantity > 0 and not is_non_stock`;
        for (const l of lines) await cancelReceipt(l.purchase_order_line_id, l.accepted_quantity, tx);
      }
      // 【仮】B-03 が無いので在庫の記録の取消(cancelMovement)はしない
      await tx`
        update delivery_slip_lines set purchase_order_line_id = null, match_result = null, units_quantity = null,
               expected_quantity = null, expected_unit_price = null, accepted_quantity = null, movement_id = null
        where slip_id = ${slipId}`;
      await tx`
        update delivery_slips set status = 'confirmed', purchase_order_id = null, match_status = null, review_reasons = null,
               matched_at = null, accepted_by = null, accepted_at = null, accept_note = ${`【検収の取消】${reason}`},
               task_id = null, updated_by = ${by}
        where id = ${slipId}`;
    });
  } catch (e) {
    if (e instanceof CancelAbort) return { ok: false, reason: e.reason };
    console.error("検収を取り消せませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
};

// ---- C-01 の確定の取消のあと(C-01 EV-11 手順3) ----

// 確認を頼んだタスクを閉じる(照合の結果の列は C-01 の unconfirmSlip が空に戻す)
export const closeReceivingTasks = async (slipId: string, note: string): Promise<void> => {
  await completeTasksBySource(RECEIVING_FEATURE_ID, slipId, { types: [RECEIVING_TASK_TYPE], status: "cancelled", note });
};

// ---- EV-02 G02 の発注の候補と未納の明細 ----

export type PoOption = { id: string; orderNo: string; orderDate: string | null; expectedDate: string | null; open: boolean };

// 同じ仕入先の「発注済み」「一部入荷」の発注(結び付いている発注が候補に無ければ先頭に足す)。並びは 5.1 の③と同じ
export const getPoOptions = async (slip: ReceivingSlip, lines: ReceivingLine[]): Promise<PoOption[]> => {
  if (!slip.supplierId) return [];
  const open = (await findOpenPurchaseOrders({ supplierId: slip.supplierId })).map(toMatchPo);
  const { candidates } = pickPurchaseOrder({ orderRef: slip.orderRef, deliveryDate: slip.deliveryDate, lines, candidates: open });
  const options: PoOption[] = candidates.map((c) => ({ id: c.id, orderNo: c.orderNo, orderDate: c.orderDate, expectedDate: c.expectedDate, open: true }));
  if (slip.purchaseOrderId && !options.some((o) => o.id === slip.purchaseOrderId)) {
    const [po] = await query(
      (sql) => sql<{ id: string; order_no: string; order_date: string | null; expected_date: string | null }[]>`
        select id, order_no, order_date::text as order_date, expected_date::text as expected_date
        from purchase_orders where id = ${slip.purchaseOrderId}`
    );
    if (po) options.unshift({ id: po.id, orderNo: po.order_no, orderDate: po.order_date, expectedDate: po.expected_date, open: false });
  }
  return options;
};

// 結び付いた発注の明細(未納の行を出すため)
export const getLinkedPoLines = async (purchaseOrderId: string | null): Promise<OpenPurchaseOrderLine[]> =>
  purchaseOrderId ? ((await getPurchaseOrderLines([purchaseOrderId])).get(purchaseOrderId) ?? []) : [];

// ---- EV-09 検収の一覧(G01) ----

// review: 要確認(照合待ち・要確認) / accepted: 検収済み / all: すべて(確かめ中・取消は出さない)
export type ReceivingView = "review" | "accepted" | "all";
export const isReceivingView = (v: string): v is ReceivingView => v === "review" || v === "accepted" || v === "all";
export type ReceivingFilter = { view: ReceivingView; supplierId: string; from: string; to: string };

export const listReceiving = async (filter: ReceivingFilter, page: number): Promise<{ total: number; items: ReceivingSlip[] }> => {
  const statuses: SlipStatus[] =
    filter.view === "review" ? ["confirmed", "needs_review"] : filter.view === "accepted" ? ["accepted"] : ["confirmed", "needs_review", "accepted"];
  const where = (sql: SqlLike) => sql`
    where d.status = any(${statuses}::text[])
      ${filter.supplierId ? sql`and d.supplier_id = ${filter.supplierId}` : sql``}
      ${filter.from ? sql`and d.delivery_date >= ${filter.from}` : sql``}
      ${filter.to ? sql`and d.delivery_date <= ${filter.to}` : sql``}`;
  const [count] = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from delivery_slips d ${where(sql)}`);
  const rows = await query(
    (sql) => sql<SlipRow[]>`
      ${SELECT_SLIP(sql)} ${where(sql)}
      order by (d.status <> 'accepted') desc, d.delivery_date desc nulls last, d.created_at desc
      limit ${RECEIVING_RULES.pageSize} offset ${(page - 1) * RECEIVING_RULES.pageSize}`
  );
  return { total: count?.n ?? 0, items: rows.map(toSlip) };
};

// 要確認の件数と、今月(日本時間)の検収の件数を match_status ごとに(EV-09 手順3)
export const countReceiving = async (): Promise<{ review: number; month: Record<MatchStatus, number> }> => {
  const today = todayJST();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [review] = await query(
    (sql) => sql<{ n: number }[]>`select count(*)::int as n from delivery_slips where status in ('confirmed', 'needs_review')`
  );
  const rows = await query(
    (sql) => sql<{ match_status: MatchStatus; n: number }[]>`
      select match_status, count(*)::int as n from delivery_slips
      where status = 'accepted' and (accepted_at at time zone 'Asia/Tokyo')::date >= ${monthStart}::date
      group by match_status`
  );
  const month: Record<MatchStatus, number> = { auto_accepted: 0, needs_review: 0, reviewed: 0, no_order: 0 };
  for (const r of rows) if (r.match_status in month) month[r.match_status] = r.n;
  return { review: review?.n ?? 0, month };
};
