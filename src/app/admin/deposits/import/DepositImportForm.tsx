"use client";

// G02 明細の取り込みの画面の部品(E-06 EV-02・EV-03。A-01 の共通の取り込みの流れ: 内容を確認する → 登録する)。
// 確認は同じ画面に出し、選んだファイルはそのまま残す。「登録する」でファイルをもう一度送り、
// サーバーが読み直して確かめる(確認の結果はDBに保存しない)。エラーが1件でもあれば登録できない(02 G02)。
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { formatQuantity } from "@/utils/format";
import type { BankImportPreview, BankImportResponse } from "./importChecks";

type AccountOption = { id: string; label: string; formatLabel: string | null; importable: boolean };

export function DepositImportForm({
  uploadUrl,
  accounts,
  defaultAccountId,
  cancelAction,
}: {
  uploadUrl: string;
  accounts: AccountOption[];
  defaultAccountId: string;
  cancelAction: (batchId: string) => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [preview, setPreview] = useState<BankImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | "cancel" | null>(null);
  const account = accounts.find((a) => a.id === accountId) ?? null;

  const send = async (intent: "preview" | "apply"): Promise<BankImportResponse | null> => {
    if (!account?.importable) return { ok: false, error: "口座を選んでください。" };
    const file = fileRef.current?.files?.[0];
    if (!file) return { ok: false, error: "CSVファイル（4MBまで）を選んでください。" };
    const body = new FormData();
    body.set("intent", intent);
    body.set("account_id", account.id);
    body.set("file", file);
    if (intent === "apply" && preview) body.set("batch_id", preview.batchId);
    const res = await fetch(uploadUrl, { method: "POST", body });
    // ログインが切れたときなどは、サーバーが移した先(ログイン画面など)へ移る
    if (!res.headers.get("content-type")?.includes("application/json")) {
      window.location.href = res.url;
      return null;
    }
    return (await res.json()) as BankImportResponse;
  };

  const run = async (intent: "preview" | "apply") => {
    setBusy(intent);
    setError(null);
    try {
      const result = await send(intent);
      if (!result) return;
      if (!result.ok) setError(result.error);
      else if (result.step === "preview") setPreview(result.preview);
      else router.push(result.redirectTo);
    } catch {
      setError("通信できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  // 「やり直す」: 確認中の記録を取消にして、ファイルを選び直せるようにする
  const reset = async () => {
    if (!preview) return;
    setBusy("cancel");
    try {
      const result = await cancelAction(preview.batchId);
      setError(result.error);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(null);
    }
  };

  const hasErrors = (preview?.errorCount ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}

      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <Field
          id="account_id"
          label="① 口座"
          required
          description={account?.formatLabel ? `形: ${account.formatLabel}` : "この口座の明細は、まだ取り込めません。"}
        >
          <Select
            id="account_id"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPreview(null);
              setError(null);
            }}
            className="max-w-md"
          >
            {accountId === "" && <option value="">選んでください</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.importable}>
                {a.label}
                {a.importable ? "" : "（取り込めません）"}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="file"
          label="② ファイル"
          required
          description="ネットバンキングの「入出金明細」からCSVをダウンロードしてください。"
        >
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
        <p className="text-xs text-ink-muted">※ファイルは4MBまでです。取り込んだファイルそのものは保存しません。</p>
        <div className="flex justify-end">
          <Button disabled={busy !== null || !account?.importable} onClick={() => run("preview")}>
            {busy === "preview" ? "確認中…" : "内容を確認する"}
          </Button>
        </div>
      </section>

      {/* 確認(まだ登録していない) */}
      {preview && (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">確認（まだ登録していません）</h2>
          <p className="text-sm text-ink-muted">
            {preview.fileName}（{preview.encodingLabel}・形: {preview.formatLabel}）
          </p>
          <div className="flex flex-col gap-1 text-sm tabular-nums">
            {preview.summary.map((s) => (
              <p key={s}>{s}</p>
            ))}
            <p className={hasErrors ? "font-bold text-danger" : ""}>
              {hasErrors ? "⚠ " : ""}エラー {formatQuantity(preview.errorCount)}件
            </p>
            {preview.errors.map((e) => (
              <p key={e} className="text-danger">
                ⚠ {e}
              </p>
            ))}
          </div>
          {preview.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          {preview.unusedColumns.length > 0 && (
            <p className="text-sm text-ink-muted">使わなかった列: {preview.unusedColumns.join("、")}</p>
          )}

          {preview.rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <caption className="px-3 py-2 text-left text-sm font-bold">先頭の{preview.rows.length}件</caption>
                <thead className="border-b border-line bg-canvas text-left">
                  <tr>
                    <th className="px-3 py-2 text-right">行</th>
                    <th className="px-3 py-2">取引日</th>
                    <th className="px-3 py-2">摘要</th>
                    <th className="px-3 py-2 text-right">入金（円）</th>
                    <th className="px-3 py-2 text-right">出金（円）</th>
                    <th className="px-3 py-2 text-right">残高（円）</th>
                    <th className="px-3 py-2">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-b border-line last:border-b-0 align-top">
                      <td className="px-3 py-2 text-right tabular-nums">{r.line}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.dateLabel}</td>
                      <td className="px-3 py-2 break-words">{r.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.deposit > 0 ? formatQuantity(r.deposit) : "−"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.withdrawal > 0 ? formatQuantity(r.withdrawal) : "−"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.balance === null ? "−" : formatQuantity(r.balance)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.statusLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" disabled={busy !== null} onClick={reset}>
              {busy === "cancel" ? "取消中…" : "やり直す"}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              {hasErrors && <p className="text-sm text-ink-muted">エラーがあるため登録できません。CSVを直してやり直してください。</p>}
              {!hasErrors && preview.newCount === 0 && <p className="text-sm text-ink-muted">登録する明細がありません。</p>}
              <Button disabled={busy !== null || hasErrors || preview.newCount === 0} onClick={() => run("apply")}>
                {busy === "apply" ? "登録中…" : `登録する（新規 ${formatQuantity(preview.newCount)}件）`}
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
