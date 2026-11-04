"use client";

// D-02 G03 返信のひな形の編集(新規も同じ)の入力フォーム(03 EV-07)。
// 差し込み欄のボタンを押すと、本文の入力中の位置に {…} を入れる。
import { useActionState, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import type { FormState } from "@/utils/formState";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIMITS,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_PURPOSES,
  isTemplateCategory,
} from "@/utils/replyTemplateRules";

// D-06 CH-07 の説明(02 G03 の注)
const NAME_DESCRIPTION = `画面で選ぶときに出す名前（${TEMPLATE_LIMITS.name}文字まで）`;
const SORT_DESCRIPTION = `0〜${TEMPLATE_LIMITS.sortOrderMax}`;
const SUBJECT_DESCRIPTION = `${TEMPLATE_LIMITS.subject}文字まで（任意）`;
const BODY_DESCRIPTION =
  "変えてはいけない文（返品の手順・期限・送料・返送先など）は【決まり】〜【ここまで】で囲んでください。AIはこの部分を変えずに使います。";

export function TemplateForm({
  action,
  initialValues,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = state.values;
  const e = state.errors;
  const [category, setCategory] = useState(v.category ?? "");

  const purposes = isTemplateCategory(category) ? TEMPLATE_PURPOSES[category] : {};
  const placeholders = isTemplateCategory(category) ? TEMPLATE_PLACEHOLDERS[category] : TEMPLATE_PLACEHOLDERS.common;

  // 押すと本文の入力中の位置に入れる
  const insert = (name: string) => {
    const el = document.getElementById("body");
    if (!(el instanceof HTMLTextAreaElement)) return;
    el.focus();
    el.setRangeText(`{${name}}`, el.selectionStart, el.selectionEnd, "end");
  };

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="grid gap-4 md:grid-cols-[12rem_18rem]">
          <Field id="category" label="種類" required error={e.category}>
            <Select
              id="category"
              name="category"
              required
              value={category}
              onChange={(ev) => setCategory(ev.currentTarget.value)}
              invalid={!!e.category}
            >
              <option value="" disabled>
                選んでください
              </option>
              {Object.entries(TEMPLATE_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="purpose" label="用途" required error={e.purpose}>
            {/* 種類を変えたら選び直す(key で作り直す) */}
            <Select
              key={category}
              id="purpose"
              name="purpose"
              required
              defaultValue={category === (v.category ?? "") ? (v.purpose ?? "") : ""}
              invalid={!!e.purpose}
            >
              <option value="" disabled>
                {category ? "選んでください" : "先に種類を選んでください"}
              </option>
              {Object.entries(purposes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_10rem]">
          <Field id="name" label="名前" required description={NAME_DESCRIPTION} error={e.name}>
            <TextInput
              id="name"
              name="name"
              required
              defaultValue={v.name ?? ""}
              invalid={!!e.name}
              aria-describedby={fieldDescribedBy("name", { description: NAME_DESCRIPTION, error: e.name })}
            />
          </Field>
          <Field id="sort_order" label="並び順" description={SORT_DESCRIPTION} error={e.sort_order}>
            <TextInput
              id="sort_order"
              name="sort_order"
              inputMode="numeric"
              defaultValue={v.sort_order ?? ""}
              invalid={!!e.sort_order}
              aria-describedby={fieldDescribedBy("sort_order", { description: SORT_DESCRIPTION, error: e.sort_order })}
            />
          </Field>
        </div>
        <Field id="subject" label="件名" description={SUBJECT_DESCRIPTION} error={e.subject}>
          <TextInput
            id="subject"
            name="subject"
            defaultValue={v.subject ?? ""}
            invalid={!!e.subject}
            aria-describedby={fieldDescribedBy("subject", { description: SUBJECT_DESCRIPTION, error: e.subject })}
          />
        </Field>
        <Field id="body" label="本文" required description={BODY_DESCRIPTION} error={e.body}>
          <TextArea
            id="body"
            name="body"
            required
            rows={14}
            defaultValue={v.body ?? ""}
            invalid={!!e.body}
            aria-describedby={fieldDescribedBy("body", { description: BODY_DESCRIPTION, error: e.body })}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-bold">差し込み欄（押すと本文に入ります）</p>
          <div className="flex flex-wrap gap-2">
            {placeholders.map((p) => (
              <Button key={p} variant="secondary" onClick={() => insert(p)}>
                {`{${p}}`}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Checkbox name="is_active" value="1" label="使う" defaultChecked={(v.is_active ?? "") === "1"} />
          {e.is_active && <p className="text-sm text-danger">⚠ {e.is_active}</p>}
        </div>
      </section>

      <div className="flex justify-end">
        <SubmitButton pendingText="保存中…">保存する</SubmitButton>
      </div>
    </form>
  );
}
