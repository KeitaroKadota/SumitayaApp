"use client";

// E-07 G02 領収書の撮影(03 EV-02・EV-05)。撮影するとすぐに画像を送り(端末で縮小してサーバー経由。FileUploader の uploadPreparedFile)、
// 送り終わってから下書きの作成と読み取りの操作(createExpenseFromReceipt・retakeReceipt)を呼ぶ。
// 読み取りの間は「読み取り中…（30秒ほどかかることがあります）」を出し、二重に押せないようにする。
import { startTransition, useActionState, useState } from "react";
import { Alert } from "@/components/Alert";
import { FileUploader, uploadPreparedFile, type PreparedFile } from "@/components/FileUploader";
import { emptyFormState, type FormState } from "@/utils/formState";

export function ReceiptCapture({
  action,
  endpoint,
  configured,
  version,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  endpoint: string;
  configured: boolean;
  // 撮り直すとき(CH-18)
  version?: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const busy = sending || pending;

  const onChange = async (next: PreparedFile[]) => {
    setFiles(next);
    setSendError("");
    const file = next[0];
    if (!file || busy) return;
    // 手順3: 画像を送る
    setSending(true);
    const r = await uploadPreparedFile(endpoint, file);
    setSending(false);
    if (!r.ok) {
      setSendError(r.error);
      return;
    }
    // 手順4〜8: 下書きを作って読み取る(終わると G02 へ移る)
    const fd = new FormData();
    fd.set("file_id", r.id);
    if (version) fd.set("version", version);
    startTransition(() => formAction(fd));
  };

  return (
    <div className="flex flex-col gap-2">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {sendError && <Alert tone="error">{sendError}</Alert>}
      <FileUploader files={files} onChange={onChange} configured={configured} maxFiles={1} allowPdf={false} disabled={busy} />
      {sending && <p className="text-sm text-primary">送信中…</p>}
      {pending && <p className="text-sm font-bold text-primary">読み取り中…（30秒ほどかかることがあります）</p>}
    </div>
  );
}
