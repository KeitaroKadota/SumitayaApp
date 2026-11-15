"use client";

// G02 売上の取り込み(確認→登録)の画面の部品(A-01 EV-02・EV-03)。B-01 の CrossmallImportForm と同じ作り:
// 確認は同じ画面に出し、選んだファイルはそのまま残す。「この内容で登録」でファイルをもう一度送り、サーバーが読み直して確かめる。
// エラーの行は取り込まない(ほかの行は取り込める)。
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/Alert";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { formatDateShort, formatQuantity } from "@/utils/format";
import type { SalesImportPreview, SalesImportResponse } from "./importTypes";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  error: { label: "エラー", tone: "danger" },
  change: { label: "変更", tone: "warning" },
  delete: { label: "削除", tone: "neutral" },
  add: { label: "追加", tone: "success" },
};

export function SalesImportForm({ kinds }: { kinds: { value: string; label: string }[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(kinds[0]?.value ?? "");
  const [preview, setPreview] = useState<SalesImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  const run = async (intent: "preview" | "apply") => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("CSVファイルを選んでください（4MBまで）。");
      return;
    }
    setBusy(intent);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      body.set("intent", intent);
      body.set("kind", kind);
      body.set("file", file);
      if (intent === "apply" && preview) body.set("batch_id", preview.batchId);
      const res = await fetch("/admin/sales/import/upload", { method: "POST", body });
      // ログインが切れたときなどは、サーバーが移した先(ログイン画面など)へ移る
      if (!res.headers.get("content-type")?.includes("application/json")) {
        window.location.href = res.url;
        return;
      }
      const result = (await res.json()) as SalesImportResponse;
      if (!result.ok) setError(result.error);
      else if (result.step === "preview") setPreview(result.preview);
      else {
        setPreview(null);
        setDone(result.message);
        router.refresh();
      }
    } catch {
      setError("通信できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  const c = preview?.counts;
  const canApply = !!preview && !!preview.batchId && !!c && c.add + c.change + c.delete > 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <RadioGroup
          name="kind"
          label="取り込むもの"
          options={kinds}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPreview(null);
          }}
        />
        <Field id="file" label="ファイル" required description="CSV（Shift_JIS または UTF-8、4MBまで）。数年分は1か月ずつに分けてください。">
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
        <div className="flex justify-end">
          <Button disabled={busy !== null} onClick={() => run("preview")}>
            {busy === "preview" ? "確認中…" : "内容を確認"}
          </Button>
        </div>
      </section>

      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}

      {preview && c && (
        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">確認の結果（まだ保存していません）</h2>
          <p className="text-sm text-ink-muted">
            {preview.fileName}（{preview.encodingLabel}、{preview.periodLabel}、{formatQuantity(preview.dataRowCount)}行）
          </p>
          <p className="text-sm">
            {preview.kindLabel}　販路: {preview.channelLabel}
          </p>
          <p className="text-sm tabular-nums">
            追加 {formatQuantity(c.add)} / 変更 {formatQuantity(c.change)} / 変更なし {formatQuantity(c.same)} / 削除{" "}
            {formatQuantity(c.delete)} / 対象外 {formatQuantity(c.skip)} /{" "}
            <span className={c.error > 0 ? "font-bold text-danger" : ""}>エラー {formatQuantity(c.error)}</span>
          </p>
          {preview.unknownProductCount > 0 && (
            <p className="text-sm">マスタに無い商品 {formatQuantity(preview.unknownProductCount)}件（取り込みます）</p>
          )}
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
                <thead className="border-b border-line bg-canvas text-left">
                  <tr>
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2 text-right">行</th>
                    <th className="px-3 py-2">日付</th>
                    <th className="px-3 py-2">商品コード</th>
                    <th className="px-3 py-2">商品名</th>
                    <th className="px-3 py-2 text-right">数量</th>
                    <th className="px-3 py-2 text-right">売上（円・税込）</th>
                    <th className="px-3 py-2">内容</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={`${r.status}-${r.line ?? ""}-${r.date ?? ""}-${r.code}-${i}`} className="border-b border-line last:border-b-0 align-top">
                      <td className="px-3 py-2">
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.line ?? "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{r.date ? formatDateShort(r.date) : ""}</td>
                      <td className="px-3 py-2 tabular-nums">{r.code}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.qtyText}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.amountText}</td>
                      <td className={`px-3 py-2 ${r.status === "error" ? "text-danger" : ""}`}>{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-muted">（エラー・変更・削除を先に、最大200行まで表示します。件数はすべて数えています）</p>
          <p className="text-sm text-ink-muted">※エラーの行は取り込みません（ほかの行は取り込めます）。</p>
          <p className="text-sm text-ink-muted">※この期間・販路の売上は、ファイルの内容で置き換えます。</p>
          {!preview.batchId && <Alert tone="error">取り込みの記録を作れませんでした。もう一度『内容を確認』してください。</Alert>}
          <div className="flex justify-end">
            <Button disabled={busy !== null || !canApply} onClick={() => run("apply")}>
              {busy === "apply" ? "登録中…" : "この内容で登録"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
