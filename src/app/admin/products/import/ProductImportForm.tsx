"use client";

// G06 商品のCSV取り込みの画面の部品(CMN-02 EV-11〜EV-13。A-01 の共通の取り込みの流れ: 確認 → 登録)。
// 手順2は手順1と同じ画面に出し、選んだファイルはそのまま残す。「登録する」でファイルをもう一度送り、
// サーバーが読み直して確かめる(確認の結果はDBに保存しない)。
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Field } from "@/components/Field";
import { formatQuantity } from "@/utils/format";
import type { PlannedRowKind } from "@/utils/productCsv";
import { cancelProductImport } from "./actions";
import type { ProductImportPreview, ProductImportResponse } from "./importTypes";

const KIND_LABELS: Record<PlannedRowKind, string> = { add: "追加", update: "更新", same: "変更なし", error: "エラー" };
const TABS = [
  { key: "all", label: "すべて" },
  { key: "add", label: "追加" },
  { key: "update", label: "更新" },
  { key: "error", label: "エラー" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const UPLOAD_URL = "/admin/products/import/upload";
// 一覧は200行ずつ表示(02 G06)
const ROWS_PER_VIEW = 200;

export function ProductImportForm({ columnsText }: { columnsText: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | "cancel" | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [skipErrors, setSkipErrors] = useState(false);

  const send = async (intent: "preview" | "apply"): Promise<ProductImportResponse | null> => {
    const file = fileRef.current?.files?.[0];
    if (!file) return { ok: false, error: "CSVファイル（4MBまで）を選んでください。" };
    const body = new FormData();
    body.set("intent", intent);
    body.set("file", file);
    if (intent === "apply" && preview) {
      body.set("batch_id", preview.batchId);
      body.set("skip_errors", skipErrors ? "1" : "0");
    }
    const res = await fetch(UPLOAD_URL, { method: "POST", body });
    // ログインが切れたときなどは、サーバーが移した先(ログイン画面など)へ移る
    if (!res.headers.get("content-type")?.includes("application/json")) {
      window.location.href = res.url;
      return null;
    }
    return (await res.json()) as ProductImportResponse;
  };

  const run = async (intent: "preview" | "apply") => {
    setBusy(intent);
    setError(null);
    try {
      const result = await send(intent);
      if (!result) return;
      if (!result.ok) setError(result.error);
      else if (result.step === "preview") {
        setPreview(result.preview);
        setTab("all");
        setSkipErrors(false);
      } else router.push(result.redirectTo);
    } catch {
      setError("通信できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!preview) return;
    setBusy("cancel");
    try {
      const result = await cancelProductImport(preview.batchId);
      setError(result.error);
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const rows = preview ? preview.rows.filter((r) => tab === "all" || r.kind === tab).slice(0, ROWS_PER_VIEW) : [];
  const hasErrors = (preview?.counts.error ?? 0) > 0;
  const nothingToApply = preview ? preview.counts.add + preview.counts.update === 0 : true;
  const applyBlocked = hasErrors && !skipErrors;

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}

      {/* 手順1 ファイルを選ぶ */}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <Field id="file" label="CSVファイル" required description={columnsText}>
          <input
            ref={fileRef}
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="min-h-11 text-base"
            onChange={() => {
              // ファイルを選び直したら、確認をやり直す
              setPreview(null);
              setError(null);
            }}
          />
        </Field>
        <p className="text-xs text-ink-muted">※空欄の項目は「変更しない」として扱います。ファイルは4MBまでです。</p>
        <div className="flex justify-end">
          <Button disabled={busy !== null} onClick={() => run("preview")}>
            {busy === "preview" ? "確認中…" : "内容を確認する"}
          </Button>
        </div>
      </section>

      {/* 手順2 確認して登録する */}
      {preview && (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">
            {preview.fileName}（{preview.encodingLabel}・{formatQuantity(preview.dataRowCount)}行）
          </h2>
          <p className="text-sm tabular-nums">
            追加 {formatQuantity(preview.counts.add)}件　更新 {formatQuantity(preview.counts.update)}件　変更なし{" "}
            {formatQuantity(preview.counts.same)}件　エラー {formatQuantity(preview.counts.error)}件
          </p>
          {preview.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          {preview.unusedColumns.length > 0 && (
            <p className="text-sm text-ink-muted">使わなかった列: {preview.unusedColumns.join("、")}</p>
          )}

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="表示する区分">
            {TABS.map((t) => (
              <Button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                variant={tab === t.key ? "primary" : "secondary"}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </Button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">この区分の行はありません。</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-canvas text-left">
                  <tr>
                    <th className="px-3 py-2 text-right">行</th>
                    <th className="px-3 py-2">区分</th>
                    <th className="px-3 py-2">商品コード</th>
                    <th className="px-3 py-2">商品名</th>
                    <th className="px-3 py-2">内容</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.line}-${r.kind}`} className="border-b border-line last:border-b-0 align-top">
                      <td className="px-3 py-2 text-right tabular-nums">{r.line}</td>
                      <td className={`px-3 py-2 ${r.kind === "error" ? "font-bold text-danger" : ""}`}>
                        {KIND_LABELS[r.kind]}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.productCode || "（空）"}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">
                        {r.kind === "error" ? <span className="text-danger">⚠ {r.detail}</span> : r.detail}
                        {r.warning && <p className="text-warning">⚠ {r.warning}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-muted">区分ごとに最大{ROWS_PER_VIEW}行まで表示します（件数はすべて数えています）。</p>

          {hasErrors && (
            <Checkbox
              label="エラーの行を除いて登録する"
              checked={skipErrors}
              onChange={(e) => setSkipErrors(e.currentTarget.checked)}
            />
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {applyBlocked && <p className="text-sm text-ink-muted">エラーの行があるため、チェックを入れると登録できます。</p>}
            {!applyBlocked && nothingToApply && <p className="text-sm text-ink-muted">登録する内容がありません。</p>}
            <Button variant="secondary" disabled={busy !== null} onClick={cancel}>
              {busy === "cancel" ? "取消中…" : "取り消す"}
            </Button>
            <Button disabled={busy !== null || applyBlocked || nothingToApply} onClick={() => run("apply")}>
              {busy === "apply" ? "登録中…" : "登録する"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
