"use client";

// G05 の「読み替えのコード」欄(CMN-02 EV-22・EV-23)。登録済みの商品だけに出す。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field, fieldDescribedBy } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";
import { ALIAS_SOURCES, type AliasSource } from "@/utils/masterRules";

export function AliasSection({
  aliases,
  addAction,
  deleteAction,
}: {
  aliases: { id: string; source: AliasSource; externalCode: string }[];
  addAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction] = useActionState(addAction, emptyFormState);
  const e = state.errors;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">読み替えのコード（レジ・モールで違うコード）</h2>
      {aliases.length === 0 ? (
        <p className="text-sm text-ink-muted">読み替えのコードはまだありません。</p>
      ) : (
        <table className="w-full max-w-xl text-sm">
          <thead className="border-b border-line text-left">
            <tr>
              <th className="px-3 py-2">取り込み元</th>
              <th className="px-3 py-2">元のコード</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2">{ALIAS_SOURCES[a.source]}</td>
                <td className="px-3 py-2 tabular-nums">{a.externalCode}</td>
                <td className="px-3 py-2">
                  <form action={deleteAction}>
                    <input type="hidden" name="alias_id" value={a.id} />
                    <ConfirmSubmitButton
                      variant="secondary"
                      pendingText="削除中…"
                      confirmMessage="この読み替えを削除してよいですか？すでに結び付けた売上はそのままです。"
                    >
                      削除する
                    </ConfirmSubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={formAction} className="flex flex-col gap-2">
        {state.formError && <Alert tone="error">{state.formError}</Alert>}
        <div className="flex flex-wrap items-end gap-3">
          <Field id="alias_source" label="取り込み元" error={e.source}>
            <Select id="alias_source" name="source" defaultValue={state.values.source ?? "pos"} className="w-40">
              {Object.entries(ALIAS_SOURCES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="external_code" label="元のコード" required error={e.external_code}>
            <TextInput
              id="external_code"
              name="external_code"
              required
              defaultValue={state.values.external_code ?? ""}
              invalid={!!e.external_code}
              aria-describedby={fieldDescribedBy("external_code", { error: e.external_code })}
              className="w-64"
            />
          </Field>
          <SubmitButton variant="secondary" pendingText="追加中…">
            追加する
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
