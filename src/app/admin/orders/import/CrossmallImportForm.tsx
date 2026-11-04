"use client";

// G03 受注CSV・G04 在庫CSVの取り込みの画面の部品(B-01 EV-03〜EV-06。A-01 の共通の取り込みの流れ: 読み込む → 登録)。
// 確認は同じ画面に出し、選んだファイルはそのまま残す。「登録する」でファイルをもう一度送り、
// サーバーが読み直して確かめる(確認の結果はDBに保存しない)。エラーが1件でもあれば登録できない(02 G03)。
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { formatQuantity } from "@/utils/format";
import type { CrossmallImportPreview, CrossmallImportResponse } from "@/utils/crossmall/importChecks";

export function CrossmallImportForm({
  uploadUrl,
  description,
  keyLabel,
  subLabel,
  cancelAction,
}: {
  uploadUrl: string;
  description: string;
  // 表の列名(受注番号・注文日時／商品コード・商品名)
  keyLabel: string;
  subLabel: string;
  cancelAction: (batchId: string) => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<CrossmallImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | "cancel" | null>(null);
  const [tab, setTab] = useState("all");

  const send = async (intent: "preview" | "apply"): Promise<CrossmallImportResponse | null> => {
    const file = fileRef.current?.files?.[0];
    if (!file) return { ok: false, error: "CSVファイル（4MBまで）を選んでください。" };
    const body = new FormData();
    body.set("intent", intent);
    body.set("file", file);
    if (intent === "apply" && preview) body.set("batch_id", preview.batchId);
    const res = await fetch(uploadUrl, { method: "POST", body });
    // ログインが切れたときなどは、サーバーが移した先(ログイン画面など)へ移る
    if (!res.headers.get("content-type")?.includes("application/json")) {
      window.location.href = res.url;
      return null;
    }
    return (await res.json()) as CrossmallImportResponse;
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
      const result = await cancelAction(preview.batchId);
      setError(result.error);
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const rows = preview ? preview.rows.filter((r) => tab === "all" || r.kind === tab) : [];
  const hasErrors = (preview?.errorCount ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}

      {/* ファイルを選ぶ */}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <Field id="file" label="CSVファイル" required description={description}>
          <input
            ref={fileRef}
            id="file"
            name="file"
            type="file"
            accept=".csv,.txt,text/csv"
            className="min-h-11 text-base"
            onChange={() => {
              // ファイルを選び直したら、確認をやり直す
              setPreview(null);
              setError(null);
            }}
          />
        </Field>
        <p className="text-xs text-ink-muted">※ファイルは4MBまでです。</p>
        <div className="flex justify-end">
          <Button disabled={busy !== null} onClick={() => run("preview")}>
            {busy === "preview" ? "読み込み中…" : "読み込む"}
          </Button>
        </div>
      </section>

      {/* 確認(まだ登録していない) */}
      {preview && (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">確認（まだ登録していません）</h2>
          <p className="text-sm text-ink-muted">
            {preview.fileName}（{preview.encodingLabel}・{formatQuantity(preview.dataRowCount)}行）
          </p>
          <div className="flex flex-col gap-1 text-sm tabular-nums">
            {preview.summary.map((s) => (
              <p key={s}>{s}</p>
            ))}
            <p className={hasErrors ? "font-bold text-danger" : ""}>
              {hasErrors ? "⚠ " : ""}エラー {formatQuantity(preview.errorCount)}件
            </p>
          </div>
          {preview.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          {preview.unusedColumns.length > 0 && (
            <p className="text-sm text-ink-muted">使わなかった列: {preview.unusedColumns.join("、")}</p>
          )}

          <div className="flex flex-wrap gap-2" role="tablist" aria-label="表示する区分">
            {[{ key: "all", label: "すべて", count: -1 }, ...preview.tabs].map((t) => (
              <Button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                variant={tab === t.key ? "primary" : "secondary"}
                onClick={() => setTab(t.key)}
              >
                {t.count >= 0 ? `${t.label}（${formatQuantity(t.count)}）` : t.label}
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
                    <th className="px-3 py-2">{keyLabel}</th>
                    <th className="px-3 py-2">{subLabel}</th>
                    <th className="px-3 py-2">区分</th>
                    <th className="px-3 py-2">内容</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.line}-${r.kind}-${r.key}`} className="border-b border-line last:border-b-0 align-top">
                      <td className="px-3 py-2 text-right tabular-nums">{r.line}</td>
                      <td className="px-3 py-2 tabular-nums">{r.key || "（空）"}</td>
                      <td className="px-3 py-2 tabular-nums">{r.sub}</td>
                      <td className={`px-3 py-2 ${r.isError ? "font-bold text-danger" : ""}`}>{r.kindLabel}</td>
                      <td className="px-3 py-2">
                        {r.isError ? <span className="text-danger">⚠ {r.detail}</span> : r.detail}
                        {r.warning && <p className="text-warning">⚠ {r.warning}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-muted">区分ごとに最大200行まで表示します（件数はすべて数えています）。</p>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasErrors && <p className="text-sm text-ink-muted">エラーがあるため登録できません。CSVを直して読み込み直してください。</p>}
            {!hasErrors && !preview.hasChanges && <p className="text-sm text-ink-muted">登録する内容がありません。</p>}
            <Button variant="secondary" disabled={busy !== null} onClick={cancel}>
              {busy === "cancel" ? "取消中…" : "やめる"}
            </Button>
            <Button disabled={busy !== null || hasErrors || !preview.hasChanges} onClick={() => run("apply")}>
              {busy === "apply" ? "登録中…" : preview.applyLabel}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
