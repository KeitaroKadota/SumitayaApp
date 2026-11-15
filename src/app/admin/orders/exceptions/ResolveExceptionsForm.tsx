"use client";

// B-02 G02 例外の対応欄の「対応のメモ」と「対応済みにする」(03 EV-04)。
// 表示中の未対応の理由をすべてまとめて対応済みにする(初回は理由ごとに分けない)。結果の文は対応済みになった後も出す。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field } from "@/components/Field";
import { TextArea } from "@/components/TextArea";
import { RESOLUTION_NOTE_MAX } from "@/utils/orderExceptionRules";
import type { ResolveState } from "./actions";

export function ResolveExceptionsForm({
  action,
  hasOpen,
}: {
  action: (prev: ResolveState, formData: FormData) => Promise<ResolveState>;
  // 未対応の理由が残っているか(無ければフォームを隠す)
  hasOpen: boolean;
}) {
  const [state, formAction] = useActionState(action, { error: null, done: false, note: "" });

  return (
    <div className="flex flex-col gap-2">
      {state.done && <Alert tone="success">対応済みにしました。</Alert>}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {hasOpen && (
        <form action={formAction} className="flex flex-col gap-2">
          <Field id="resolution_note" label="対応のメモ">
            <TextArea
              id="resolution_note"
              name="resolution_note"
              defaultValue={state.note}
              maxLength={RESOLUTION_NOTE_MAX}
              placeholder="例: お客様に電話で確認。文字は「新津」で確定。工場に依頼済み"
            />
          </Field>
          <div className="flex justify-end">
            <ConfirmSubmitButton
              variant="primary"
              confirmMessage="未対応の理由をすべて対応済みにします。よいですか？"
              pendingText="保存中…"
            >
              対応済みにする
            </ConfirmSubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
