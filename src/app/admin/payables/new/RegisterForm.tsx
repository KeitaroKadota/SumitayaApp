"use client";

// E-04 G02 請求書の登録のフォーム(03 EV-03・EV-04)。
// 押した直後にファイルを送り(画像はサーバー経由、PDF は署名付きURLで直接。FileUploader の uploadPreparedFile)、
// 送り終わってから登録と読み取りの操作(registerReceivedInvoice)を呼ぶ。読み取りの間はボタンを「読み取り中…」にして押せなくする。
import { startTransition, useActionState, useRef, useState } from "react";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { FileUploader, uploadPreparedFile, type PreparedFile } from "@/components/FileUploader";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { emptyFormState, type FormState } from "@/utils/formState";
import { FILE_MESSAGES } from "@/utils/storageRules";

const KIND_OPTIONS = [
  { value: "purchase", label: "仕入れ（発注・検収と照らし合わせる）" },
  { value: "other", label: "その他（家賃・電気・外注など）" },
] as const;

export function RegisterForm({
  action,
  suppliers,
  configured,
  endpoint,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  suppliers: { id: string; name: string }[];
  configured: boolean;
  endpoint: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  // 送り終わったファイル(押し直したときに同じファイルを2回送らない)
  const uploaded = useRef<{ key: string; id: string } | null>(null);
  const busy = sending || pending;
  const e = state.errors;

  const onSubmit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (busy) return;
    setSendError("");
    const submitter = (ev.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const nextMode = submitter?.value === "manual" ? "manual" : "ai";
    setMode(nextMode);
    const fd = new FormData(ev.currentTarget);
    fd.set("mode", nextMode);
    const file = files[0];
    if (file) {
      let id = uploaded.current?.key === file.key ? uploaded.current.id : null;
      if (!id) {
        // 手順1: ファイルを送る
        setSending(true);
        const r = await uploadPreparedFile(endpoint, file);
        setSending(false);
        if (!r.ok) {
          setSendError(r.error);
          return;
        }
        id = r.id;
        uploaded.current = { key: file.key, id };
      }
      fd.set("file_id", id);
    }
    startTransition(() => formAction(fd));
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {!configured && <Alert tone="warning">{FILE_MESSAGES.notConfigured}</Alert>}
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {sendError && <Alert tone="error">{sendError}</Alert>}

      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
        <RadioGroup
          name="kind"
          label="種類"
          required
          options={KIND_OPTIONS}
          defaultValue={state.values.kind || "purchase"}
          disabled={busy}
          error={e.kind}
        />
        <Field id="supplier_id" label="仕入先（分かれば）" error={e.supplier_id}>
          <Select id="supplier_id" name="supplier_id" defaultValue={state.values.supplier_id ?? ""} disabled={busy} invalid={!!e.supplier_id}>
            <option value="">AIに任せる</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm font-bold">請求書</p>
          <FileUploader
            files={files}
            onChange={(next) => {
              setFiles(next);
              setSendError("");
            }}
            configured={configured}
            maxFiles={1}
            disabled={busy}
            note=" 複数ページの請求書は、PDFにまとめてから取り込んでください。"
          />
          {e.file && <p className="text-sm text-danger">⚠ {e.file}</p>}
        </div>
      </div>

      <button
        type="submit"
        name="mode"
        value="ai"
        disabled={busy || !configured || files.length === 0}
        className={buttonClassName("primary", "lg", "w-full")}
      >
        {sending ? "送信中…" : pending && mode === "ai" ? "読み取り中…（30秒ほどかかることがあります）" : "登録して読み取る"}
      </button>
      {configured && files.length === 0 && <p className="text-sm text-ink-muted">請求書の写真かPDFを選ぶと押せます。</p>}
      <button
        type="submit"
        name="mode"
        value="manual"
        disabled={busy}
        className="min-h-11 self-start text-sm font-bold text-primary hover:underline disabled:opacity-50"
      >
        {pending && mode === "manual" ? "登録中…" : "AIを使わずに手で入力する"}
      </button>
    </form>
  );
}
