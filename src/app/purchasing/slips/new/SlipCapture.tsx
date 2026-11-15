"use client";

// C-01 G02 納品書を撮る・上げる(03 EV-01・EV-05)。ページを選ぶとすぐに1枚ずつ送り(画像は縮小してサーバー経由、
// PDF は署名付きURLで直接。FileUploader の uploadPreparedFile。00_仮決め一覧 C-01-仮-11)、
// 全部送れたら「上げて読み取る」で納品書を作って読み取る(createDeliverySlip。終わると G03 へ移る)。
// 同じ画像がすでに上がっていれば知らせる(CH-03。保存は止めない)。
import { startTransition, useActionState, useRef, useState } from "react";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { FileUploader, uploadPreparedFile, type PreparedFile } from "@/components/FileUploader";
import { Select } from "@/components/Select";
import { SLIP_MAX_PAGES } from "@/utils/deliverySlipRules";
import { emptyFormState, type FormState } from "@/utils/formState";
import { FILE_MESSAGES } from "@/utils/storageRules";

type Sent = { id: string; duplicate: string | null };

export function SlipCapture({
  action,
  duplicateNote,
  suppliers,
  configured,
  endpoint,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  duplicateNote: (duplicateOf: string) => Promise<string | null>;
  suppliers: { id: string; name: string }[];
  configured: boolean;
  endpoint: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  // 送り終わったページ(ファイルの key → 記録のID・同じ画像の知らせ)
  const [sent, setSent] = useState<Record<string, Sent>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sendError, setSendError] = useState("");
  const sending = useRef(false);
  const busy = pending || progress !== null;
  const allSent = files.length > 0 && files.every((f) => sent[f.key]);

  // 手順4: まだ送っていないページを1枚ずつ送る(「送っています（2/3）」)
  const sendPending = async (list: PreparedFile[], already: Record<string, Sent>) => {
    if (sending.current) return;
    const todo = list.filter((f) => !already[f.key]);
    if (todo.length === 0) return;
    sending.current = true;
    setSendError("");
    let next = { ...already };
    for (const [i, f] of todo.entries()) {
      setProgress({ done: i + 1, total: todo.length });
      const r = await uploadPreparedFile(endpoint, f);
      if (!r.ok) {
        // 送れなかったページは外す(送れたページは残す)
        setSendError(r.error);
        setFiles((prev) => prev.filter((p) => p.key !== f.key));
        continue;
      }
      const duplicate = r.duplicateOf ? await duplicateNote(r.duplicateOf) : null;
      next = { ...next, [f.key]: { id: r.id, duplicate } };
      setSent(next);
    }
    setProgress(null);
    sending.current = false;
  };

  const onChange = (next: PreparedFile[]) => {
    setFiles(next);
    void sendPending(next, sent);
  };

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (busy || !allSent) return;
    const fd = new FormData(ev.currentTarget);
    for (const f of files) fd.append("file_id", sent[f.key].id);
    startTransition(() => formAction(fd));
  };

  const duplicates = files.map((f) => sent[f.key]?.duplicate).filter((d): d is string => Boolean(d));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {sendError && <Alert tone="error">{sendError}</Alert>}

      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
        <Field id="supplier_id" label="仕入先（分かれば）" error={state.errors.supplier_id}>
          <Select id="supplier_id" name="supplier_id" defaultValue={state.values.supplier_id ?? ""} disabled={busy}>
            <option value="">選ばない（AIが読み取る）</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-bold">ページ</p>
          <FileUploader
            files={files}
            onChange={onChange}
            configured={configured}
            maxFiles={SLIP_MAX_PAGES}
            disabled={busy}
            note={` 1件の納品書に${SLIP_MAX_PAGES}ページまで。続けて撮ると、ページの順に並びます。`}
          />
          {duplicates.map((d) => (
            <p key={d} className="text-sm text-warning">
              ⚠ {d}
            </p>
          ))}
        </div>
      </div>

      {configured ? (
        <button type="submit" disabled={busy || !allSent} className={buttonClassName("primary", "lg", "w-full")}>
          {progress ? `送っています（${progress.done}/${progress.total}）…` : pending ? "読み取り中…（10〜30秒かかります）" : "上げて読み取る"}
        </button>
      ) : (
        <Alert tone="warning">{FILE_MESSAGES.notConfigured}納品書を上げられません（担当者に連絡してください）。</Alert>
      )}
      {configured && files.length === 0 && <p className="text-sm text-ink-muted">納品書の写真かPDFを選ぶと押せます。</p>}
    </form>
  );
}
