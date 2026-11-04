"use client";

// E-07 G04 承認・差し戻しのフォーム(03 EV-06・EV-13・EV-15)。expenses_approve の人にだけ出す。
// 勘定科目は直してから承認できる(直したら手で選んだことになる)。要確認の承認では「ひとこと」が必須(CH-14)。
// 欄の値は画面で持つ(エラーのときも入力を消さないため)。
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AiBadge } from "@/components/AiDraft";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import { EXPENSE_LIMITS } from "@/utils/expenseClaims";
import type { FormState } from "@/utils/formState";

function IntentButton({ intent, variant, children, pendingText }: { intent: string; variant: "primary" | "danger"; children: React.ReactNode; pendingText: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} className={buttonClassName(variant)}>
      {mine ? pendingText : children}
    </button>
  );
}

export function DecideForm({
  action,
  version,
  back,
  titles,
  initialTitleId,
  estimated,
  needsNote,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  version: string;
  back: string;
  titles: { id: string; name: string }[];
  initialTitleId: string;
  estimated: { titleId: string; reason: string; ai: boolean } | null;
  // 印があるか(ひとことが必須)
  needsNote: boolean;
}) {
  const initialValues = { account_title_id: initialTitleId, approve_note: "", return_reason: "" };
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const [vals, setVals] = useState<Record<string, string>>(initialValues);
  const e = state.errors;
  const set = (name: string, value: string) => setVals((prev) => ({ ...prev, [name]: value }));

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="back" value={back} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Field id="d_account_title_id" label="勘定科目" required error={e.account_title_id}>
        <Select
          id="d_account_title_id"
          name="account_title_id"
          value={vals.account_title_id}
          onChange={(ev) => set("account_title_id", ev.currentTarget.value)}
          invalid={!!e.account_title_id}
          className="sm:w-72"
        >
          <option value="">選んでください</option>
          {titles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        {estimated && vals.account_title_id === estimated.titleId && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {estimated.ai && <AiBadge />}（{estimated.reason}）
          </p>
        )}
      </Field>
      <Field
        id="d_approve_note"
        label="ひとこと"
        required={needsNote}
        description={needsNote ? "確認が必要な点を見たうえで承認するときに入力します。" : undefined}
        error={e.approve_note}
      >
        <TextInput
          id="d_approve_note"
          name="approve_note"
          value={vals.approve_note}
          onChange={(ev) => set("approve_note", ev.currentTarget.value)}
          invalid={!!e.approve_note}
          maxLength={EXPENSE_LIMITS.approveNote}
        />
      </Field>
      <Field id="d_return_reason" label="差し戻す理由" error={e.return_reason}>
        <TextInput
          id="d_return_reason"
          name="return_reason"
          value={vals.return_reason}
          onChange={(ev) => set("return_reason", ev.currentTarget.value)}
          invalid={!!e.return_reason}
          maxLength={EXPENSE_LIMITS.returnReason}
          placeholder="例: 用途を書いてください"
        />
      </Field>
      <div className="flex flex-wrap justify-between gap-2">
        <IntentButton intent="return" variant="danger" pendingText="差し戻し中…">
          差し戻す
        </IntentButton>
        <IntentButton intent="approve" variant="primary" pendingText="承認中…">
          承認する
        </IntentButton>
      </div>
    </form>
  );
}
