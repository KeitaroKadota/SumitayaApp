// 納品書の読み取り(C-01)のDBの読み書き(03 EV-04〜EV-12、04 CH-03〜CH-05・CH-09〜CH-13)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("purchasing") を済ませている前提)。
// AIを呼ぶのは readSlipWithAi だけ。見直し(計算)は deliverySlipRules.ts の checkSlip で行う。
// C-02(照合・検収)が E-04 に渡す関数は src/utils/deliverySlips.ts(C-02 の担当)に置く。ここには置かない。
import { query, transaction, type SqlLike, type TransactionSql } from "@/utils/db";
import {
  ITEM_CODE_HINT_MAX,
  READ_STALE_MINUTES,
  SLIP_AI_TIMEOUT_MS,
  SLIP_PAGE_SIZE,
  checkSlip,
  normalizeAiSlip,
  type CheckFlag,
  type ReadStatus,
  type SlipHeader,
  type SlipLineInput,
  type SlipStatus,
} from "@/utils/deliverySlipRules";
import { callGeminiJson } from "@/utils/gemini";
import { todayJST } from "@/utils/jst";
import { normalizeCompanyName } from "@/utils/payables";
import { DELIVERY_SLIP_INSTRUCTION, DELIVERY_SLIP_SCHEMA, supplierSlipHintText } from "@/utils/prompts/C-01";
import { getFileBytes } from "@/utils/storage";
import type { FileContentType } from "@/utils/storageRules";
import { toHalfWidth } from "@/utils/textNormalize";

export const SLIP_FEATURE_ID = "C-01";
export const SLIPS_URL = "/admin/purchasing/slips";
export const ITEM_CODES_URL = "/admin/purchasing/item-codes";
export const CAPTURE_URL = "/purchasing/slips/new";
export const slipUrl = (id: string) => `${SLIPS_URL}/${encodeURIComponent(id)}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_PATTERN.test(v);

// ---- 読み取り ----

export type Slip = SlipHeader & {
  id: string;
  fileIds: string[];
  readStatus: ReadStatus;
  status: SlipStatus;
  needsCheck: boolean;
  supplierName: string | null;
  supplierNameRead: string | null;
  confidence: number | null;
  checkFlags: CheckFlag[];
  aiRequestId: string | null;
  aiResult: unknown | null;
  confirmedAt: Date | null;
  confirmedByName: string | null;
  createdAt: Date;
  // 読み取り中のまま2分たったか(CH-05。止まったとみなして読み取り直してよい)
  readingStale: boolean;
  // ほかの人の更新を見るための updated_at(マイクロ秒の数の文字。E-04 の CH-18 と同じ作り)
  version: string;
};

export type SlipLine = SlipLineInput & {
  id: string;
  lineNo: number;
  productCode: string | null;
  productName: string | null;
  checkFlags: CheckFlag[];
};

type SlipRow = {
  id: string;
  file_ids: string[];
  read_status: ReadStatus;
  status: SlipStatus;
  needs_check: boolean;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_name_read: string | null;
  slip_no: string | null;
  delivery_date: string | null;
  order_ref: string | null;
  tax_included: boolean;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  confidence: number | null;
  check_flags: CheckFlag[];
  ai_request_id: string | null;
  ai_result: unknown | null;
  note: string | null;
  confirmed_at: Date | null;
  confirmed_by_name: string | null;
  created_at: Date;
  reading_stale: boolean;
  version: string;
};

const SELECT_SLIP = (sql: SqlLike) => sql`
  select d.id, d.file_ids, d.read_status, d.status, d.needs_check, d.supplier_id, s.name as supplier_name, d.supplier_name_read,
         d.slip_no, to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date, d.order_ref, d.tax_included, d.subtotal, d.tax,
         d.total, d.confidence::float8 as confidence, d.check_flags, d.ai_request_id, d.ai_result, d.note, d.confirmed_at,
         case when c.id is null then null else c.last_name || ' ' || c.first_name end as confirmed_by_name, d.created_at,
         (d.read_status = 'reading' and d.updated_at < now() - make_interval(mins => ${READ_STALE_MINUTES}::int)) as reading_stale,
         (extract(epoch from d.updated_at) * 1000000)::bigint::text as version
  from delivery_slips d
  left join suppliers s on s.id = d.supplier_id
  left join employees c on c.id = d.confirmed_by`;

const toSlip = (r: SlipRow): Slip => ({
  id: r.id,
  fileIds: r.file_ids,
  readStatus: r.read_status,
  status: r.status,
  needsCheck: r.needs_check,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  supplierNameRead: r.supplier_name_read,
  slipNo: r.slip_no,
  deliveryDate: r.delivery_date,
  orderRef: r.order_ref,
  taxIncluded: r.tax_included,
  subtotal: r.subtotal,
  tax: r.tax,
  total: r.total,
  note: r.note,
  confidence: r.confidence,
  checkFlags: Array.isArray(r.check_flags) ? r.check_flags : [],
  aiRequestId: r.ai_request_id,
  aiResult: r.ai_result,
  confirmedAt: r.confirmed_at,
  confirmedByName: r.confirmed_by_name,
  createdAt: r.created_at,
  readingStale: r.reading_stale,
  version: r.version,
});

const readLines = async (slipId: string): Promise<SlipLine[]> => {
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
        confidence: number | null;
        check_flags: CheckFlag[];
        is_edited: boolean;
      }[]
    >`
      select l.id, l.line_no, l.supplier_item_code, l.item_name, l.spec, l.quantity::float8 as quantity, l.unit, l.unit_price,
             l.amount, l.product_id, p.product_code, p.name as product_name, l.is_non_stock, l.confidence::float8 as confidence,
             l.check_flags, l.is_edited
      from delivery_slip_lines l left join products p on p.id = l.product_id
      where l.slip_id = ${slipId} order by l.line_no`
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
    confidence: r.confidence,
    checkFlags: Array.isArray(r.check_flags) ? r.check_flags : [],
    isEdited: r.is_edited,
  }));
};

// 1件と明細を読む。無ければ null
export const getSlip = async (id: string): Promise<{ slip: Slip; lines: SlipLine[] } | null> => {
  if (!isUuid(id)) return null;
  const [row] = await query((sql) => sql<SlipRow[]>`${SELECT_SLIP(sql)} where d.id = ${id}`);
  if (!row) return null;
  return { slip: toSlip(row), lines: await readLines(id) };
};

// ページのファイルの種類・名前(画像の表示に使う)。ページ順
export const getSlipFiles = async (fileIds: string[]): Promise<{ id: string; contentType: FileContentType; name: string }[]> => {
  if (fileIds.length === 0) return [];
  const rows = await query(
    (sql) => sql<{ id: string; content_type: FileContentType; original_name: string }[]>`
      select id, content_type, original_name from stored_files where id = any(${fileIds}::uuid[]) and deleted_at is null`
  );
  return fileIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ id: r.id, contentType: r.content_type, name: r.original_name }));
};

// ---- G01 一覧 ----

export type SlipFilter = { status: SlipStatus | ""; supplierId: string; from: string; to: string };

export const listSlips = async (filter: SlipFilter, page: number): Promise<{ total: number; items: Slip[] }> => {
  const where = (sql: SqlLike) => sql`
    where true
      ${filter.status ? sql`and d.status = ${filter.status}` : sql``}
      ${filter.supplierId ? sql`and d.supplier_id = ${filter.supplierId}` : sql``}
      ${filter.from ? sql`and d.delivery_date >= ${filter.from}` : sql``}
      ${filter.to ? sql`and d.delivery_date <= ${filter.to}` : sql``}`;
  const [count] = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from delivery_slips d ${where(sql)}`);
  // 並び: 確かめ中を上 → 納品日の新しい順(02 G01)。納品日が空(読み取り中など)は確かめ中の中で上
  const rows = await query(
    (sql) => sql<SlipRow[]>`
      ${SELECT_SLIP(sql)} ${where(sql)}
      order by (d.status = 'draft') desc, d.delivery_date desc nulls first, d.created_at desc
      limit ${SLIP_PAGE_SIZE} offset ${(page - 1) * SLIP_PAGE_SIZE}`
  );
  return { total: count?.n ?? 0, items: rows.map(toSlip) };
};

// ---- CH-03 同じファイルの二重の登録 ----

// 同じ指紋のファイル(duplicateOf)が使われている納品書の納品日(無ければ上げた日)の文
export const duplicateNoteOf = async (fileId: string): Promise<string | null> => {
  if (!isUuid(fileId)) return null;
  const [slip] = await query(
    (sql) => sql<{ delivery_date: string | null; created_at: Date }[]>`
      select to_char(delivery_date, 'YYYY-MM-DD') as delivery_date, created_at from delivery_slips
      where ${fileId}::uuid = any(file_ids) and status <> 'cancelled' order by created_at limit 1`
  );
  if (slip) return slip.delivery_date ?? slip.created_at.toISOString();
  const [file] = await query((sql) => sql<{ created_at: Date }[]>`select created_at from stored_files where id = ${fileId}`);
  return file ? file.created_at.toISOString() : null;
};

// ---- CH-04 納品書のページ ----

// すべて stored_files にあり、用途が delivery_slip、上げた人が本人、消しておらず、ほかの納品書に使われていない
export const arePagesUsable = async (fileIds: string[], by: string): Promise<boolean> => {
  if (fileIds.length === 0 || new Set(fileIds).size !== fileIds.length || !fileIds.every(isUuid)) return false;
  const [row] = await query(
    (sql) => sql<{ n: number }[]>`
      select count(*)::int as n from stored_files f
      where f.id = any(${fileIds}::uuid[]) and f.purpose = 'delivery_slip' and f.created_by = ${by} and f.deleted_at is null
        and not exists (select 1 from delivery_slips d where f.id = any(d.file_ids))`
  );
  return row?.n === fileIds.length;
};

// ---- EV-05 納品書を作る ----

export const createSlip = async (fileIds: string[], supplierId: string | null, by: string): Promise<string> => {
  const [row] = await query(
    (sql) => sql<{ id: string }[]>`
      insert into delivery_slips (file_ids, supplier_id, read_status, status, created_by, updated_by)
      values (${fileIds}::uuid[], ${supplierId}, 'pending', 'draft', ${by}, ${by})
      returning id`
  );
  return row.id;
};

// ---- EV-06 AIで読み取る ----

type SupplierRow = { id: string; name: string; aliases: string[]; phone: string | null; ocr_hint: string | null };

const listSuppliersForMatch = () =>
  query((sql) => sql<SupplierRow[]>`select id, name, aliases, phone, ocr_hint from suppliers where is_active`);

const phoneDigitsOf = (v: string | null) => (v ? toHalfWidth(v).replace(/\D/g, "") : "");

// 手順8: 読んだ名前・電話を、仕入先の名前・別名・電話と照らし、1つに決まれば返す
const identifySupplier = (suppliers: SupplierRow[], name: string | null, phone: string | null): string | null => {
  const target = name ? normalizeCompanyName(name) : "";
  if (target) {
    const byName = suppliers.filter((s) => [s.name, ...s.aliases].some((n) => normalizeCompanyName(n) === target));
    if (byName.length === 1) return byName[0].id;
  }
  const digits = phoneDigitsOf(phone);
  if (digits.length >= 10) {
    const byPhone = suppliers.filter((s) => phoneDigitsOf(s.phone) === digits);
    if (byPhone.length === 1) return byPhone[0].id;
  }
  return null;
};

// 仕入先の品番 → 自社の商品(使っている対応だけ)
const lookupItemCodes = async (supplierId: string | null, codes: (string | null)[]): Promise<Map<string, string>> => {
  const unique = [...new Set(codes.filter((c): c is string => Boolean(c)))];
  if (!supplierId || unique.length === 0) return new Map();
  const rows = await query(
    (sql) => sql<{ supplier_item_code: string; product_id: string }[]>`
      select supplier_item_code, product_id from supplier_item_codes
      where supplier_id = ${supplierId} and is_active and supplier_item_code = any(${unique}::text[])`
  );
  return new Map(rows.map((r) => [r.supplier_item_code, r.product_id]));
};

// 見直しの印を足し合わせる(読み取りのときは、整えたときの印と計算の印を合わせる)
const mergeFlags = (a: CheckFlag[], b: CheckFlag[]): CheckFlag[] => {
  const seen = new Set<string>();
  return [...a, ...b].filter((f) => {
    const key = `${f.field}\t${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const insertLines = async (tx: TransactionSql, slipId: string, lines: SlipLineInput[], flags: CheckFlag[][]) => {
  for (const [i, l] of lines.entries()) {
    await tx`
      insert into delivery_slip_lines (slip_id, line_no, supplier_item_code, item_name, spec, quantity, unit, unit_price, amount,
                                       product_id, is_non_stock, confidence, check_flags, is_edited)
      values (${slipId}, ${i + 1}, ${l.supplierItemCode}, ${l.itemName}, ${l.spec}, ${l.quantity}, ${l.unit}, ${l.unitPrice},
              ${l.amount}, ${l.productId}, ${l.isNonStock}, ${l.confidence}, ${tx.json(flags[i] ?? [])}, ${l.isEdited})`;
  }
};

export type ReadOutcome = "done" | "manual" | "failed" | "busy";

const setReadStatus = (slipId: string, status: ReadStatus, by: string) =>
  query((sql) => sql`update delivery_slips set read_status = ${status}, updated_by = ${by} where id = ${slipId}`);

// readSlipWithAi(EV-05 と G03 の「もう一度AIで読み取る」から呼ぶ)。読めなかったときも伝票は残し、手入力で続けられるようにする
export const readSlipWithAi = async (slipId: string, by: string): Promise<ReadOutcome> => {
  // 手順1・2: CH-05(確かめ中で、いま読み取り中でない。読み取り中のまま2分過ぎたものは読み取り直してよい)
  const [locked] = await query(
    (sql) => sql<{ file_ids: string[]; supplier_id: string | null }[]>`
      update delivery_slips set read_status = 'reading', updated_by = ${by}
      where id = ${slipId} and status = 'draft'
        and (read_status <> 'reading' or updated_at < now() - make_interval(mins => ${READ_STALE_MINUTES}::int))
      returning file_ids, supplier_id`
  );
  if (!locked) return "busy";

  // 手順3: ファイルの中身(ページ順)
  const files: { bytes: Uint8Array; mimeType: string }[] = [];
  try {
    for (const id of locked.file_ids) {
      const f = await getFileBytes(id);
      if (!f) throw new Error("ファイルが見つからない");
      files.push({ bytes: f.bytes, mimeType: f.contentType });
    }
  } catch (e) {
    console.error("納品書のファイルを読めませんでした:", e instanceof Error ? e.message : e);
    await setReadStatus(slipId, "failed", by);
    return "failed";
  }

  // 手順4: 仕入先が選ばれていれば、読み取りの注意と品番の一覧(最大200件)を添える
  const suppliers = await listSuppliersForMatch();
  const chosen = locked.supplier_id ? (suppliers.find((s) => s.id === locked.supplier_id) ?? null) : null;
  let input = "添付の納品書を読み取ってください。";
  if (chosen) {
    const codes = await query(
      (sql) => sql<{ supplier_item_code: string; supplier_item_name: string | null }[]>`
        select supplier_item_code, supplier_item_name from supplier_item_codes
        where supplier_id = ${chosen.id} and is_active order by supplier_item_code limit ${ITEM_CODE_HINT_MAX}`
    );
    input = supplierSlipHintText(
      chosen.name,
      chosen.ocr_hint,
      codes.map((c) => ({ code: c.supplier_item_code, name: c.supplier_item_name }))
    );
  }

  // 手順5: AI(全ページを1回の呼び出しでまとめて送る)
  const ai = await callGeminiJson<unknown>({
    featureId: SLIP_FEATURE_ID,
    purpose: "delivery_slip_ocr",
    targetTable: "delivery_slips",
    targetId: slipId,
    instruction: DELIVERY_SLIP_INSTRUCTION,
    input,
    files,
    schema: DELIVERY_SLIP_SCHEMA,
    requestedBy: by,
    timeoutMs: SLIP_AI_TIMEOUT_MS,
  });
  if (!ai.ok) {
    // 上限で止められた・APIキーが無い → 手入力 / 失敗・形が違う・時間切れ → 失敗(どちらも手入力で続けられる)
    const status: ReadStatus = ai.reason === "quota" || ai.reason === "disabled" ? "manual" : "failed";
    await setReadStatus(slipId, status, by);
    return status === "manual" ? "manual" : "failed";
  }
  // 手順7: 受け取った値を整える(CH-06)
  const normalized = normalizeAiSlip(ai.data);
  if (!normalized) {
    await setReadStatus(slipId, "failed", by);
    return "failed";
  }

  // 手順8: 仕入先を決める(選ばれていればそのまま)
  const supplierId = locked.supplier_id ?? identifySupplier(suppliers, normalized.supplierNameRead, normalized.supplierPhoneRead);
  // 手順9: 明細ごとに、対応表で自社の商品を引く
  const map = await lookupItemCodes(supplierId, normalized.lines.map((l) => l.supplierItemCode));
  const lines = normalized.lines.map((l) => ({
    ...l,
    productId: l.supplierItemCode ? (map.get(l.supplierItemCode) ?? null) : null,
  }));
  const header: SlipHeader = { ...normalized.header, supplierId, note: null };

  // 手順10: 計算の見直し(EV-09)。整えたときの印と合わせる
  const checked = checkSlip({ header, lines, slipConfidence: normalized.confidence, hasAiResult: true, today: todayJST() });
  const headerFlags = mergeFlags(normalized.headerFlags, checked.headerFlags);
  const lineFlags = lines.map((_, i) => mergeFlags(normalized.lineFlags[i] ?? [], checked.lineFlags[i] ?? []));
  const needsCheck = headerFlags.length > 0 || lineFlags.some((f) => f.length > 0);

  // 手順6・7・11: 結果を書き、明細を入れ直す(前の明細は消す)
  await transaction(async (tx) => {
    await tx`
      update delivery_slips set
        ai_result = ${tx.json(ai.data as Parameters<typeof tx.json>[0])}, ai_request_id = ${ai.requestId},
        confidence = ${normalized.confidence}, supplier_name_read = ${normalized.supplierNameRead},
        supplier_id = ${supplierId}, slip_no = ${header.slipNo}, delivery_date = ${header.deliveryDate},
        order_ref = ${header.orderRef}, tax_included = ${header.taxIncluded}, subtotal = ${header.subtotal},
        tax = ${header.tax}, total = ${header.total}, check_flags = ${tx.json(headerFlags)}, needs_check = ${needsCheck},
        read_status = 'done', updated_by = ${by}
      where id = ${slipId}`;
    await tx`delete from delivery_slip_lines where slip_id = ${slipId}`;
    await insertLines(tx, slipId, lines, lineFlags);
  });
  return "done";
};

// ---- EV-08 保存(CH-05・ほかの人の更新を見る) ----

// 画面を開いたときの updated_at のままか
export const isCurrentVersion = async (slipId: string, version: string): Promise<boolean> => {
  const [row] = await query(
    (sql) => sql<{ ok: boolean }[]>`
      select (extract(epoch from updated_at) * 1000000)::bigint::text = ${version} as ok from delivery_slips where id = ${slipId}`
  );
  return row?.ok ?? false;
};

// 伝票と明細を上書きし、見直し(EV-09)の結果を書く。ほかの人が先に更新していたら false
export const saveSlip = async (
  slipId: string,
  version: string,
  header: SlipHeader,
  lines: SlipLineInput[],
  slipConfidence: number | null,
  hasAiResult: boolean,
  by: string
): Promise<{ ok: true; hasArithmeticIssue: boolean } | { ok: false }> => {
  const checked = checkSlip({ header, lines, slipConfidence, hasAiResult, today: todayJST() });
  return transaction(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      update delivery_slips set
        supplier_id = ${header.supplierId}, slip_no = ${header.slipNo}, delivery_date = ${header.deliveryDate},
        order_ref = ${header.orderRef}, tax_included = ${header.taxIncluded}, subtotal = ${header.subtotal},
        tax = ${header.tax}, total = ${header.total}, note = ${header.note},
        check_flags = ${tx.json(checked.headerFlags)}, needs_check = ${checked.needsCheck}, updated_by = ${by}
      where id = ${slipId} and status = 'draft' and read_status <> 'reading'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`;
    if (updated.length === 0) return { ok: false as const };
    await tx`delete from delivery_slip_lines where slip_id = ${slipId}`;
    await insertLines(tx, slipId, lines, checked.lineFlags);
    return { ok: true as const, hasArithmeticIssue: checked.hasArithmeticIssue };
  });
};

// ---- CH-11 同じ伝票を二重に確定しない ----

export const findConfirmedDuplicates = async (slipId: string, header: SlipHeader): Promise<{ id: string; deliveryDate: string | null }[]> => {
  if (!header.supplierId) return [];
  const rows = await query(
    (sql) => sql<{ id: string; delivery_date: string | null }[]>`
      select id, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date from delivery_slips
      where id <> ${slipId} and supplier_id = ${header.supplierId} and status in ('confirmed', 'needs_review', 'accepted')
        and ${
          header.slipNo
            ? sql`slip_no = ${header.slipNo}`
            : sql`delivery_date = ${header.deliveryDate} and total = ${header.total}`
        }
      order by created_at limit 5`
  );
  return rows.map((r) => ({ id: r.id, deliveryDate: r.delivery_date }));
};

// ---- EV-10 確定する ----

// 状態を確定にする(needs_check はそのまま残し、C-02 で使う)。確かめ中でなければ false
export const markConfirmed = async (slipId: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update delivery_slips set status = 'confirmed', confirmed_by = ${by}, confirmed_at = now(), updated_by = ${by}
      where id = ${slipId} and status = 'draft' and read_status <> 'reading'
      returning id`
  );
  return rows.length > 0;
};

// 手順6: 人が選んだ商品のうち、対応表に無い品番を足す(入数は1。後で G04 で直せる)。足した数を返す
export const learnItemCodes = async (slipId: string, by: string): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      insert into supplier_item_codes (supplier_id, supplier_item_code, supplier_item_name, product_id, pack_quantity, created_by, updated_by)
      select distinct on (l.supplier_item_code) d.supplier_id, l.supplier_item_code, nullif(left(l.item_name, 100), ''), l.product_id, 1, ${by}, ${by}
      from delivery_slip_lines l join delivery_slips d on d.id = l.slip_id
      where l.slip_id = ${slipId} and d.supplier_id is not null and l.supplier_item_code is not null and l.product_id is not null
        and not l.is_non_stock
      order by l.supplier_item_code, l.line_no
      on conflict (supplier_id, supplier_item_code) do nothing
      returning id`
  );
  return rows.length;
};

// ---- EV-11 取消・確定の取消(CH-12) ----

// 取消: 確かめ中か確定のときだけ。画像は残す(論理削除もしない)
export const cancelSlip = async (slipId: string, version: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update delivery_slips set status = 'cancelled', updated_by = ${by}
      where id = ${slipId} and status in ('draft', 'confirmed') and read_status <> 'reading'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`
  );
  return rows.length > 0;
};

// 確定の取消: 確定か、C-02 の確認待ちのときだけ(検収済みは C-02 の検収の取消が先)。C-02 の照合の結果を消す
export const unconfirmSlip = async (slipId: string, version: string, by: string): Promise<boolean> =>
  transaction(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update delivery_slips set status = 'draft', confirmed_by = null, confirmed_at = null,
             purchase_order_id = null, match_status = null, review_reasons = null, matched_at = null, task_id = null,
             updated_by = ${by}
      where id = ${slipId} and status in ('confirmed', 'needs_review')
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`;
    if (rows.length === 0) return false;
    await tx`
      update delivery_slip_lines set purchase_order_line_id = null, match_result = null, units_quantity = null,
             expected_quantity = null, expected_unit_price = null
      where slip_id = ${slipId}`;
    return true;
  });

// ---- EV-12 品番の対応表(G04) ----

export type ItemCodeRow = {
  id: string;
  supplierItemCode: string;
  supplierItemName: string | null;
  productId: string;
  productCode: string;
  productName: string;
  packQuantity: number;
  isActive: boolean;
};

// その仕入先の対応を品番の順に(検索は品番・品名の部分一致)
export const listItemCodes = async (supplierId: string, q: string): Promise<ItemCodeRow[]> => {
  if (!isUuid(supplierId)) return [];
  const like = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        supplier_item_code: string;
        supplier_item_name: string | null;
        product_id: string;
        product_code: string;
        product_name: string;
        pack_quantity: number;
        is_active: boolean;
      }[]
    >`
      select c.id, c.supplier_item_code, c.supplier_item_name, c.product_id, p.product_code, p.name as product_name,
             c.pack_quantity, c.is_active
      from supplier_item_codes c join products p on p.id = c.product_id
      where c.supplier_id = ${supplierId}
        ${like ? sql`and (c.supplier_item_code ilike ${like} or c.supplier_item_name ilike ${like} or p.name ilike ${like})` : sql``}
      order by c.supplier_item_code limit 500`
  );
  return rows.map((r) => ({
    id: r.id,
    supplierItemCode: r.supplier_item_code,
    supplierItemName: r.supplier_item_name,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    packQuantity: r.pack_quantity,
    isActive: r.is_active,
  }));
};

// 上書き(id があるとき)か、新しい行を足す。同じ仕入先・同じ品番があれば重複不可の制約で失敗する(CH-13。呼ぶ側で文にする)
export const saveItemCode = async (input: {
  id: string | null;
  supplierId: string;
  supplierItemCode: string;
  supplierItemName: string | null;
  productId: string;
  packQuantity: number;
  isActive: boolean;
  by: string;
}): Promise<boolean> => {
  if (input.id) {
    const rows = await query(
      (sql) => sql<{ id: string }[]>`
        update supplier_item_codes set supplier_item_code = ${input.supplierItemCode}, supplier_item_name = ${input.supplierItemName},
               product_id = ${input.productId}, pack_quantity = ${input.packQuantity}, is_active = ${input.isActive},
               updated_by = ${input.by}
        where id = ${input.id} and supplier_id = ${input.supplierId}
        returning id`
    );
    return rows.length > 0;
  }
  await query(
    (sql) => sql`
      insert into supplier_item_codes (supplier_id, supplier_item_code, supplier_item_name, product_id, pack_quantity, is_active,
                                       created_by, updated_by)
      values (${input.supplierId}, ${input.supplierItemCode}, ${input.supplierItemName}, ${input.productId}, ${input.packQuantity},
              ${input.isActive}, ${input.by}, ${input.by})`
  );
  return true;
};

// 使っている仕入先か(選び直しの確認)
export const isActiveSupplier = async (supplierId: string): Promise<boolean> => {
  if (!isUuid(supplierId)) return false;
  const [row] = await query((sql) => sql<{ ok: boolean }[]>`select is_active as ok from suppliers where id = ${supplierId}`);
  return row?.ok ?? false;
};

