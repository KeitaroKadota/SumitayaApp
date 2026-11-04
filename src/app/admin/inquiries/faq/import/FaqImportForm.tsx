"use client";

// D-03 G04 よくある質問のCSV取り込みの画面の部品(03 EV-07。A-01 の共通の取り込みの流れ: 確認 → 登録)。
// 商品の取り込み(ProductImportForm)と同じ作り。「登録する」でファイルをもう一度送り、サーバーが読み直して確かめる。
// エラーの行は登録しない(EV-07 手順1)。
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { formatQuantity } from "@/utils/format";
import type { FaqPlannedKind } from "@/utils/faqCsv";
import { cancelFaqImport } from "./actions";
import type { FaqImportPreview, FaqImportResponse } from "./importTypes";

const KIND_LABELS: Record<FaqPlannedKind, string> = { add: "新規", update: "更新", error: "エラー" };
const TABS = [
  { key: "all", label: "すべて" },
  { key: "add", label: "新規" },
  { key: "update", label: "更新" },
  { key: "error", label: "エラー" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const UPLOAD_URL = "/admin/inquiries/faq/import/upload";
// 区分ごとに200行まで表示(商品の取り込みと同じ)
const ROWS_PER_VIEW = 200;

export function FaqImportForm({ columnsText }: { columnsText: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<FaqImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | "cancel" | null>(null);
  const [tab, setTab] = useState<TabKey>("all");

  const send = async (intent: "preview" | "apply"): Promise<FaqImportResponse | null> => {
    const file = fileRef.current?.files?.[0];
    if (!file) return { ok: false, error: "CSVファイル（4MBまで）を選んでください。" };
    const body = new FormData();
    body.set("intent", intent);
    body.set("file", file);
    if (intent === "apply" && preview) body.set("batch_id", preview.batchId);
    const res = await fetch(UPLOAD_URL, { method: "POST", body });
    // ログインが切れたときなどは、サーバーが移した先(ログイン画面など)へ移る
    if (!res.headers.get("content-type")?.includes("application/json")) {
      window.location.href = res.url;
      return null;
    }
    return (await res.json()) as FaqImportResponse;
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
      const result = await cancelFaqImport(preview.batchId);
      setError(result.error);
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const rows = preview ? preview.rows.filter((r) => tab === "all" || r.kind === tab).slice(0, ROWS_PER_VIEW) : [];
  const hasErrors = (preview?.counts.error ?? 0) > 0;
  const nothingToApply = preview ? preview.counts.add + preview.counts.update === 0 : true;

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
        <p className="text-xs text-ink-muted">※更新の行は、空欄の項目も空にします。ファイルは4MBまでです。</p>
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
            新規 {formatQuantity(preview.counts.add)}件　更新 {formatQuantity(preview.counts.update)}件　エラー{" "}
            {formatQuantity(preview.counts.error)}件
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
                    <th className="px-3 py-2">質問</th>
                    <th className="px-3 py-2">内容</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.line}-${r.kind}`} className="border-b border-line last:border-b-0 align-top">
                      <td className="px-3 py-2 text-right tabular-nums">{r.line}</td>
                      <td className={`px-3 py-2 ${r.kind === "error" ? "font-bold text-danger" : ""}`}>{KIND_LABELS[r.kind]}</td>
                      <td className="px-3 py-2">{r.question || "（空）"}</td>
                      <td className="px-3 py-2">{r.kind === "error" ? <span className="text-danger">⚠ {r.detail}</span> : r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-muted">区分ごとに最大{ROWS_PER_VIEW}行まで表示します（件数はすべて数えています）。</p>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasErrors && !nothingToApply && <p className="text-sm text-ink-muted">エラーの行は登録しません。</p>}
            {nothingToApply && <p className="text-sm text-ink-muted">登録する内容がありません。</p>}
            <Button variant="secondary" disabled={busy !== null} onClick={cancel}>
              {busy === "cancel" ? "取消中…" : "取り消す"}
            </Button>
            <Button disabled={busy !== null || nothingToApply} onClick={() => run("apply")}>
              {busy === "apply" ? "登録中…" : "登録する"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
