// よくある質問のCSV取り込み(D-03 02 G04、03 EV-07)。A-01 の共通の仕組み(src/utils/csvImport)の
// 「取り込みの種類 faq_entries」の中身: 列の対応表・行のチェック(CH-05・CH-06)・分類(新規／更新／エラー)・保存。
// エラーの行は登録しない(EV-07 手順1)。
import type { TransactionSql } from "@/utils/db";
import type { CsvRow } from "@/utils/csvImport/engine";
import { resolveColumns } from "@/utils/csvImport/engine";
import type { ImportCounts } from "@/utils/csvImport/batches";
import { existingFaqIds, insertFaqEntry, updateFaqEntry } from "@/utils/faq";
import { FAQ_LIMITS, validateFaqInput, type FaqInput } from "@/utils/faqRules";
import { toHalfWidth } from "@/utils/textNormalize";

// 02 G04 の列(見出しの名前)
export const FAQ_CSV_COLUMNS = {
  id: ["ID"],
  topic: ["話題"],
  question: ["質問"],
  answer: ["回答"],
  keywords: ["ことば"],
  source_name: ["根拠"],
  source_url: ["元のURL"],
  checked_on: ["確かめた日"],
  sort_order: ["並び順"],
  is_active: ["使う"],
} as const satisfies Record<string, readonly string[]>;
type CsvField = keyof typeof FAQ_CSV_COLUMNS;

// 確認の画面に返す行の数(区分ごと)
const PREVIEW_ROWS_PER_KIND = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FaqPlannedKind = "add" | "update" | "error";

type PlannedRow = { line: number; kind: FaqPlannedKind; id: string | null; question: string; messages: string[]; input: FaqInput | null };

export type FaqPreviewRow = { line: number; kind: FaqPlannedKind; question: string; detail: string };

export type FaqImportPlan =
  | { ok: true; dataRowCount: number; counts: ImportCounts; unusedColumns: string[]; rows: PlannedRow[] }
  | { ok: false; error: string };

// 使う: 1／0(空なら1)
const parseActive = (value: string): boolean | "error" => {
  const s = toHalfWidth(value).trim();
  if (s === "" || s === "1") return true;
  if (s === "0") return false;
  return "error";
};

// CSV の名前と、画面のエラーの名前(validateFaqInput の errors のキー)を合わせる
const FIELD_LABELS: Record<string, string> = {
  topic: "話題",
  question: "質問",
  answer: "回答",
  keywords: "ことば",
  source_name: "根拠",
  source_url: "元のURL",
  checked_on: "確かめた日",
  sort_order: "並び順",
};

// EV-07 手順1: 見出しを確かめ、1行ずつチェックして分ける。確認と登録の両方で呼ぶ。today は日本時間の年-月-日
export const planFaqImport = async (header: string[], rows: CsvRow[], today: string): Promise<FaqImportPlan> => {
  const { index, unused, duplicated } = resolveColumns(header, FAQ_CSV_COLUMNS);
  if (duplicated.length > 0) return { ok: false, error: `見出しに同じ列名が2回あります: ${duplicated.join("、")}` };
  const lacking = (["topic", "question", "answer", "source_name"] as const).filter((f) => index[f] === undefined);
  if (lacking.length > 0)
    return { ok: false, error: `『${lacking.map((f) => FAQ_CSV_COLUMNS[f][0]).join("』『")}』の列が見つかりません。` };

  const cell = (r: CsvRow, f: CsvField) => {
    const i = index[f];
    return i === undefined ? "" : (r.cells[i] ?? "").trim();
  };

  // ID があれば、そのFAQがあるか確かめる(まとめて1回読む)
  const ids = [...new Set(rows.map((r) => cell(r, "id")).filter(Boolean))];
  const existing = await existingFaqIds(ids);
  const seenIds = new Set<string>();

  const planned: PlannedRow[] = rows.map((r) => {
    const messages: string[] = [];
    const id = cell(r, "id").toLowerCase();
    if (id) {
      if (!UUID_PATTERN.test(id) || !existing.has(id)) messages.push("このIDのよくある質問がありません");
      else if (seenIds.has(id)) messages.push("同じIDの行がほかにあります");
      seenIds.add(id);
    }
    const active = parseActive(cell(r, "is_active"));
    if (active === "error") messages.push("使うは 1 か 0 で入れてください");
    const checked = validateFaqInput(
      {
        topic: cell(r, "topic"),
        question: cell(r, "question"),
        answer: cell(r, "answer"),
        keywords: cell(r, "keywords"),
        sourceName: cell(r, "source_name"),
        sourceUrl: cell(r, "source_url"),
        checkedOn: cell(r, "checked_on"),
        sortOrder: cell(r, "sort_order"),
      },
      active !== false,
      today
    );
    if (!checked.ok)
      for (const [key, msg] of Object.entries(checked.errors)) messages.push(`${FIELD_LABELS[key] ?? key}: ${msg.replace(/。$/, "")}`);
    const question = cell(r, "question");
    if (messages.length > 0 || !checked.ok) return { line: r.line, kind: "error", id: id || null, question, messages, input: null };
    return { line: r.line, kind: id ? "update" : "add", id: id || null, question, messages: [], input: checked.input };
  });

  const count = (k: FaqPlannedKind) => planned.filter((p) => p.kind === k).length;
  return {
    ok: true,
    dataRowCount: rows.length,
    unusedColumns: unused,
    rows: planned,
    counts: { add: count("add"), change: count("update"), same: 0, delete: 0, skip: 0, error: count("error") },
  };
};

// 確認の画面に返す行: エラー → 更新 → 新規 の順に、区分ごとに最大200行
export const faqPreviewRows = (rows: PlannedRow[]): FaqPreviewRow[] =>
  (["error", "update", "add"] as const).flatMap((kind) =>
    rows
      .filter((r) => r.kind === kind)
      .slice(0, PREVIEW_ROWS_PER_KIND)
      .map((r) => ({ line: r.line, kind: r.kind, question: r.question, detail: r.messages.join("／") }))
  );

// EV-07 手順2: 呼ぶ側のトランザクションの中で、入れる・更新する(1件でも失敗したら全部やめる)
export const applyFaqImport = async (
  tx: TransactionSql,
  rows: PlannedRow[],
  by: string
): Promise<{ added: number; updated: number }> => {
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    if (!r.input) continue;
    if (r.kind === "add") {
      await insertFaqEntry(r.input, by, tx);
      added += 1;
    } else if (r.kind === "update" && r.id) {
      // 確認の後に消えることは無い(消さない決まり)が、念のため更新できなければ全部やめる
      if (!(await updateFaqEntry(r.id, r.input, by, tx))) throw new Error("更新するよくある質問が見つからない");
      updated += 1;
    }
  }
  return { added, updated };
};

export const FAQ_CSV_READ_OPTIONS = {
  extensions: [".csv"],
  fileError: "CSVファイル（4MBまで）を選んでください。",
  maxRows: FAQ_LIMITS.csvMaxRows,
  maxRowsError: `1回に取り込めるのは${FAQ_LIMITS.csvMaxRows.toLocaleString("ja-JP")}行までです。ファイルを分けてください。`,
};
