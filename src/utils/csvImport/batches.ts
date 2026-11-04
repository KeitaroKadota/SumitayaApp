// 取り込みの記録(import_batches。A-01 01 6.2)の読み書き。確認の時点で previewed の行だけ作り、
// 確認の結果(行の中身)は保存しない(00_共通設計 7.5)。登録のときに指紋(file_hash)で同じファイルか確かめる。
import { query, type TransactionSql } from "@/utils/db";
import type { CsvEncoding } from "./decode";

// 取り込みの種類(import_batches.kind の CHECK 制約と同じ8つ。A-01 01 6.2)
export const IMPORT_KINDS = [
  "sales_pos",
  "sales_crossmall",
  "crossmall_orders",
  "crossmall_stock",
  "products",
  "bank_transactions",
  "inquiries",
  "faq_entries",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type ImportCounts = {
  add: number;
  change: number;
  same: number;
  delete: number;
  skip: number;
  error: number;
};

export type ImportBatch = {
  id: string;
  kind: ImportKind;
  fileHash: string | null;
  status: "previewed" | "applied" | "cancelled" | "failed";
  createdBy: string | null;
  createdAt: Date;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// EV-02 手順6(CMN-02 EV-11 手順6): 確認中(previewed)の記録を作る
export const createPreviewBatch = async (input: {
  kind: ImportKind;
  fileName: string;
  fileSize: number;
  fileHash: string;
  encoding: CsvEncoding;
  dataRowCount: number;
  counts: ImportCounts;
  createdBy: string;
}): Promise<string> => {
  const c = input.counts;
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      insert into import_batches (
        kind, source, file_name, file_size, file_hash, encoding, data_row_count,
        add_count, change_count, same_count, delete_count, skip_count, error_count, status, created_by, updated_by
      ) values (
        ${input.kind}, 'csv', ${input.fileName}, ${input.fileSize}, ${input.fileHash}, ${input.encoding},
        ${input.dataRowCount}, ${c.add}, ${c.change}, ${c.same}, ${c.delete}, ${c.skip}, ${c.error}, 'previewed',
        ${input.createdBy}, ${input.createdBy}
      ) returning id`
  );
  return rows[0].id;
};

type BatchRow = {
  id: string;
  kind: ImportKind;
  file_hash: string | null;
  status: ImportBatch["status"];
  created_by: string | null;
  created_at: Date;
};
const toBatch = (r: BatchRow): ImportBatch => ({
  id: r.id,
  kind: r.kind,
  fileHash: r.file_hash,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const getBatch = async (id: string): Promise<ImportBatch | null> => {
  if (!UUID_PATTERN.test(id)) return null;
  const rows = await query(
    (sql) => sql<BatchRow[]>`select id, kind, file_hash, status, created_by, created_at from import_batches where id = ${id}`
  );
  return rows[0] ? toBatch(rows[0]) : null;
};

// トランザクションの中で記録を FOR UPDATE で読み直す(二重に押された・別の画面で登録された場合を防ぐ。A-01 EV-03 手順8)
export const lockBatch = async (tx: TransactionSql, id: string): Promise<ImportBatch | null> => {
  const rows = await tx<BatchRow[]>`
    select id, kind, file_hash, status, created_by, created_at from import_batches where id = ${id} for update`;
  return rows[0] ? toBatch(rows[0]) : null;
};

// 登録済みにする(件数は登録のときの値で上書きする。A-01 EV-03 手順12)
export const markBatchApplied = async (
  tx: TransactionSql,
  id: string,
  counts: ImportCounts,
  dataRowCount: number,
  by: string
): Promise<void> => {
  await tx`
    update import_batches set
      status = 'applied', data_row_count = ${dataRowCount},
      add_count = ${counts.add}, change_count = ${counts.change}, same_count = ${counts.same},
      delete_count = ${counts.delete}, skip_count = ${counts.skip}, error_count = ${counts.error},
      applied_by = ${by}, applied_at = now(), updated_by = ${by}
    where id = ${id}`;
};

// 取消にする(確認中の記録をやめるとき。CMN-02 EV-13)
export const markBatchCancelled = async (id: string, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update import_batches set status = 'cancelled', cancelled_by = ${by}, cancelled_at = now(), updated_by = ${by}
      where id = ${id} and status = 'previewed'`
  );
};
