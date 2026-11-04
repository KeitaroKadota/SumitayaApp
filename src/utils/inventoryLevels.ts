// 商品ごとの在庫(inventory_levels)の取り込み・一覧と、在庫数を引く関数(B-01 01 6.3・7.1・7.3、03 EV-05〜EV-08、
// 04 CH-08・CH-11・CH-12)。権限チェックはしない(呼ぶ側の画面・操作で済ませている前提)。
// 在庫数(quantity)は B-01 だけが書く。初回は CROSS MALL の在庫CSVの値を正として、取り込むたびに上書きする。
import { query, type Sql, type TransactionSql } from "@/utils/db";
import type { ImportCounts } from "@/utils/csvImport/batches";
import type { CsvRow } from "@/utils/csvImport/engine";
import { resolveProductCodes } from "@/utils/masters";
import { escapeLike } from "@/utils/textNormalize";
import { DEFAULT_LOCATION_CODE } from "@/utils/crossmall/csvMapping";
import { parseStockCsv, type ParsedStockEntry } from "@/utils/crossmall/csvSource";
import type { NormalizedStock } from "@/utils/crossmall/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 【仮】1回に取り込める行数(00_仮決め一覧 B-01-仮-12)
export const STOCK_CSV_MAX_ROWS = 20_000;
// 1回の SQL で送る行数
const CHUNK_SIZE = 500;
// 確認の画面に返す行の数(区分ごと)
export const STOCK_PREVIEW_ROWS_PER_KIND = 200;
// 確認の画面に出す未登録の商品コードの数(CH-08「先頭10件」)
const UNKNOWN_CODES_SHOWN = 10;
// G05 は100件ずつ(02 G05)
export const INVENTORY_PAGE_SIZE = 100;
// CH-12 在庫の取り込みが古いとみなすまでの時間(【仮】00_仮決め一覧 B-01-仮-07。D-02 も同じ値を使う)
export const STOCK_STALE_HOURS = 24;

// ---- 取り込み(EV-05・EV-06) ----

// add: 在庫の行がまだ無い／update: 数が変わった／same: 変わらない／skip: 商品マスタに無い(登録しない)／error
export type StockPlanKind = "add" | "update" | "same" | "skip" | "error";

export type StockPlanEntry = ParsedStockEntry & {
  kind: StockPlanKind;
  productId: string | null;
  productName: string;
  previousQuantity: number | null;
};

export type StockImportPlan =
  | {
      ok: true;
      dataRowCount: number;
      unusedColumns: string[];
      entries: StockPlanEntry[];
      counts: ImportCounts;
      // 商品マスタと一致した品数
      matchedCount: number;
      // 前回から増えた・減った・0になった品数(EV-05 手順5)
      increased: number;
      decreased: number;
      becameZero: number;
      // 未登録の商品コード(先頭10件)
      unknownCodes: string[];
    }
  | { ok: false; error: string };

// EV-05 手順2〜5: 見出し・行のチェック、商品マスタを引く、今の在庫と比べる。確認と登録の両方で呼ぶ
export const planStockImport = async (header: string[], rows: CsvRow[]): Promise<StockImportPlan> => {
  const parsed = parseStockCsv(header, rows);
  if (!parsed.ok) return parsed;

  // 手順4 CH-08 商品コードで商品マスタを引く(読み替えの表も見る)
  const codes = [...new Set(parsed.entries.filter((e) => e.stock).map((e) => e.productCode))];
  const products = await resolveProductCodes("crossmall", codes);

  // 手順5 今の在庫
  const productIds = [...new Set([...products.values()].map((p) => p.id))];
  const levelRows =
    productIds.length === 0
      ? []
      : await query(
          (sql) => sql<{ product_id: string; quantity: number; allocated_quantity: number | null; available_quantity: number | null }[]>`
            select product_id, quantity, allocated_quantity, available_quantity from inventory_levels
            where location_code = ${DEFAULT_LOCATION_CODE} and product_id = any(${productIds}::uuid[])`,
          { timeoutMs: 30_000 }
        );
  const levels = new Map(levelRows.map((l) => [l.product_id, l]));

  // 読み替えで2つのコードが同じ商品になった場合は、2回目をエラーにする(CH-11)
  const firstLineByProduct = new Map<string, number>();
  const entries: StockPlanEntry[] = parsed.entries.map((e) => {
    if (!e.stock) return { ...e, kind: "error", productId: null, productName: "", previousQuantity: null };
    const product = products.get(e.productCode);
    if (!product) return { ...e, kind: "skip", productId: null, productName: "", previousQuantity: null };
    const first = firstLineByProduct.get(product.id);
    if (first !== undefined)
      return {
        ...e,
        stock: null,
        errors: [`${first}行目と同じ商品です（読み替えのコード）`],
        kind: "error",
        productId: product.id,
        productName: product.name,
        previousQuantity: null,
      };
    firstLineByProduct.set(product.id, e.line);
    const current = levels.get(product.id);
    const base = { ...e, productId: product.id, productName: product.name, previousQuantity: current?.quantity ?? null };
    if (!current) return { ...base, kind: "add" };
    const same =
      current.quantity === e.stock.quantity &&
      current.allocated_quantity === e.stock.allocatedQuantity &&
      current.available_quantity === e.stock.availableQuantity;
    return { ...base, kind: same ? "same" : "update" };
  });

  const count = (k: StockPlanKind) => entries.filter((e) => e.kind === k).length;
  const matched = entries.filter((e) => e.stock && e.productId && e.kind !== "error");
  const unknownCodes = [...new Set(entries.filter((e) => e.kind === "skip").map((e) => e.productCode))];
  return {
    ok: true,
    dataRowCount: parsed.dataRowCount,
    unusedColumns: parsed.unusedColumns,
    entries,
    counts: { add: count("add"), change: count("update"), same: count("same"), delete: 0, skip: count("skip"), error: count("error") },
    matchedCount: matched.length,
    increased: matched.filter((e) => e.previousQuantity !== null && e.stock!.quantity > e.previousQuantity).length,
    decreased: matched.filter((e) => e.previousQuantity !== null && e.stock!.quantity < e.previousQuantity).length,
    becameZero: matched.filter((e) => e.stock!.quantity === 0 && e.previousQuantity !== 0).length,
    unknownCodes: unknownCodes.slice(0, UNKNOWN_CODES_SHOWN),
  };
};

// 確認の画面に返す行(エラー → 更新 → 新規 → 未登録 の順に、区分ごとに最大200行)
export type StockPreviewRow = {
  line: number;
  kind: StockPlanKind;
  productCode: string;
  productName: string;
  detail: string;
  warning: string | null;
};

export const previewStockRows = (entries: StockPlanEntry[]): StockPreviewRow[] =>
  (["error", "update", "add", "skip"] as const).flatMap((kind) =>
    entries
      .filter((e) => e.kind === kind)
      .slice(0, STOCK_PREVIEW_ROWS_PER_KIND)
      .map((e) => ({
        line: e.line,
        kind: e.kind,
        productCode: e.productCode,
        productName: e.productName,
        detail:
          e.kind === "error"
            ? e.errors.join("／")
            : e.kind === "skip"
              ? "商品マスタに無いため登録しません"
              : `在庫数 ${e.previousQuantity ?? "（なし）"} → ${e.stock?.quantity ?? ""}`,
        warning: e.warnings.length > 0 ? e.warnings.join("／") : null,
      }))
  );

const chunks = <T>(list: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK_SIZE) out.push(list.slice(i, i + CHUNK_SIZE));
  return out;
};

// EV-06 手順2・3: 一致した商品ごとに在庫を上書きする(呼ぶ側のトランザクションの中で動かす)。
// previous_quantity に今の quantity を移し、synced_at を今にする。CSVに出てこなかった商品の在庫は変えない。
// API の取り込み(EV-09)からも同じ関数を呼ぶ。上書きした品数を返す
export const applyStocks = async (
  tx: TransactionSql,
  stocks: (NormalizedStock & { productId: string })[]
): Promise<number> => {
  let saved = 0;
  for (const chunk of chunks(stocks)) {
    const records = JSON.stringify(
      chunk.map((s) => ({
        product_id: s.productId,
        location_code: s.locationCode,
        quantity: s.quantity,
        allocated_quantity: s.allocatedQuantity,
        available_quantity: s.availableQuantity,
      }))
    );
    const rows = await tx<{ id: string }[]>`
      insert into inventory_levels (product_id, location_code, quantity, allocated_quantity, available_quantity, synced_at)
      select d.product_id, d.location_code, d.quantity, d.allocated_quantity, d.available_quantity, now()
      from jsonb_to_recordset(${records}::jsonb) as d (
        product_id uuid, location_code text, quantity integer, allocated_quantity integer, available_quantity integer
      )
      on conflict (product_id, location_code) do update set
        previous_quantity = inventory_levels.quantity,
        quantity = excluded.quantity,
        allocated_quantity = excluded.allocated_quantity,
        available_quantity = excluded.available_quantity,
        synced_at = excluded.synced_at
      returning id`;
    saved += rows.length;
  }
  return saved;
};

// 確認の結果から、登録する在庫(一致した商品の行)を取り出す
export const stocksToApply = (entries: StockPlanEntry[]): (NormalizedStock & { productId: string })[] =>
  entries.flatMap((e) =>
    e.stock && e.productId && (e.kind === "add" || e.kind === "update" || e.kind === "same")
      ? [{ ...e.stock, productId: e.productId }]
      : []
  );

// ---- 一覧(EV-07) ----

export type InventoryListItem = {
  productId: string;
  productCode: string;
  name: string;
  quantity: number;
  allocatedQuantity: number | null;
  availableQuantity: number | null;
  previousQuantity: number | null;
  syncedAt: Date;
};

export type InventoryFilter = { q: string; category: string; zeroOnly: boolean };

// EV-07 手順2: inventory_levels と products を結んで読む。商品コード順に100件
export const listInventory = async (
  filter: InventoryFilter,
  page: number
): Promise<{ total: number; items: InventoryListItem[] }> => {
  const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
  const where = (sql: Sql) => sql`
    where l.location_code = ${DEFAULT_LOCATION_CODE}
      ${filter.category ? sql`and p.category_code = ${filter.category}` : sql``}
      ${filter.zeroOnly ? sql`and l.quantity = 0` : sql``}
      ${like ? sql`and (p.product_code ilike ${like} or p.name ilike ${like} or p.jan_code ilike ${like})` : sql``}`;
  const countRows = await query(
    (sql) => sql<{ n: number }[]>`
      select count(*)::int as n from inventory_levels l join products p on p.id = l.product_id ${where(sql)}`
  );
  const rows = await query(
    (sql) => sql<
      {
        product_id: string;
        product_code: string;
        name: string;
        quantity: number;
        allocated_quantity: number | null;
        available_quantity: number | null;
        previous_quantity: number | null;
        synced_at: Date;
      }[]
    >`
      select l.product_id, p.product_code, p.name, l.quantity, l.allocated_quantity, l.available_quantity,
             l.previous_quantity, l.synced_at
      from inventory_levels l join products p on p.id = l.product_id
      ${where(sql)}
      order by p.product_code limit ${INVENTORY_PAGE_SIZE} offset ${(page - 1) * INVENTORY_PAGE_SIZE}`
  );
  return {
    total: countRows[0]?.n ?? 0,
    items: rows.map((r) => ({
      productId: r.product_id,
      productCode: r.product_code,
      name: r.name,
      quantity: r.quantity,
      allocatedQuantity: r.allocated_quantity,
      availableQuantity: r.available_quantity,
      previousQuantity: r.previous_quantity,
      syncedAt: r.synced_at,
    })),
  };
};

// EV-07 手順3: 在庫の時点(synced_at の最も新しい時刻)。まだ取り込んでいなければ null
export const getLatestStockSyncedAt = async (): Promise<Date | null> => {
  const rows = await query((sql) => sql<{ at: Date | null }[]>`select max(synced_at) as at from inventory_levels`);
  return rows[0]?.at ?? null;
};

// CH-12 在庫の取り込みが古すぎるか(24時間を超えたら true)。D-02 も同じ基準を使う
export const isStockStale = (syncedAt: Date, now: Date = new Date()): boolean =>
  now.getTime() - syncedAt.getTime() > STOCK_STALE_HOURS * 60 * 60 * 1000;

// 在庫の時点から何日たったか(「◯日前の在庫です」の表示。1日未満は 0)
export const stockAgeDays = (syncedAt: Date, now: Date = new Date()): number =>
  Math.floor((now.getTime() - syncedAt.getTime()) / (24 * 60 * 60 * 1000));

// ---- ほかの機能が使う関数(EV-08) ----

export type StockInfo = {
  quantity: number;
  // 引き当て可能な数(CSVに無ければ null。D-02 は null なら quantity を使う)
  available: number | null;
  // 在庫の時点(取り込んだ時刻)
  syncedAt: Date;
};

// D-02 在庫数を引く。まだ取り込んでいなければ null(「在庫数が分かりません」。0 とは言わない)
export const getStock = async (productId: string): Promise<StockInfo | null> => {
  if (!UUID_PATTERN.test(productId)) return null;
  const rows = await query(
    (sql) => sql<{ quantity: number; available_quantity: number | null; synced_at: Date }[]>`
      select quantity, available_quantity, synced_at from inventory_levels
      where product_id = ${productId} and location_code = ${DEFAULT_LOCATION_CODE}`
  );
  const r = rows[0];
  return r ? { quantity: r.quantity, available: r.available_quantity, syncedAt: r.synced_at } : null;
};
