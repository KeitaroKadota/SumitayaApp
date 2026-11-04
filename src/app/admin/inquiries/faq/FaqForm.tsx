"use client";

// D-03 G03 よくある質問の編集(新規も同じ)の入力フォーム(03 EV-06)。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { FAQ_LIMITS, FAQ_SOURCES, FAQ_TOPICS } from "@/utils/faqRules";
import type { FaqFormState } from "./actions";

const SOURCE_OPTIONS = Object.entries(FAQ_SOURCES).map(([value, label]) => ({ value, label }));
const ANSWER_DESCRIPTION = `お客様にそのまま見せてよい書き方で（${FAQ_LIMITS.answer.toLocaleString("ja-JP")}文字まで）。`;
const KEYWORDS_DESCRIPTION = "問い合わせの文に含まれていたら、このFAQを候補に出します。空白で区切ります（例: 法被 はっぴ 半纏 サイズ 身長）。";

export function FaqForm({
  action,
  initialValues,
}: {
  action: (prev: FaqFormState, formData: FormData) => Promise<FaqFormState>;
  initialValues: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues, duplicate: null });
  const v = state.values;
  const e = state.errors;

  const text = (name: string, label: string, opts: { required?: boolean; description?: string; className?: string; type?: string } = {}) => (
    <Field id={name} label={label} required={opts.required} description={opts.description} error={e[name]}>
      <TextInput
        id={name}
        name={name}
        type={opts.type}
        required={opts.required}
        defaultValue={v[name] ?? ""}
        invalid={!!e[name]}
        className={opts.className}
        aria-describedby={fieldDescribedBy(name, { description: opts.description, error: e[name] })}
      />
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.formError && <Alert tone={state.duplicate ? "warning" : "error"}>{state.formError}</Alert>}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="grid gap-4 md:grid-cols-[14rem_10rem]">
          <Field id="topic" label="話題" required error={e.topic}>
            <Select id="topic" name="topic" required defaultValue={v.topic ?? ""} invalid={!!e.topic}>
              <option value="" disabled>
                選んでください
              </option>
              {Object.entries(FAQ_TOPICS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {text("sort_order", "並び順", { description: `0〜${FAQ_LIMITS.sortOrderMax}` })}
        </div>
        {text("question", "質問", { required: true, description: `${FAQ_LIMITS.question}文字まで` })}
        <Field
          id="answer"
          label="回答"
          required
          description={ANSWER_DESCRIPTION}
          error={e.answer}
        >
          <TextArea
            id="answer"
            name="answer"
            required
            rows={8}
            defaultValue={v.answer ?? ""}
            invalid={!!e.answer}
            aria-describedby={fieldDescribedBy("answer", { description: ANSWER_DESCRIPTION, error: e.answer })}
          />
        </Field>
        {text("keywords", "ことば", { description: KEYWORDS_DESCRIPTION })}
        <RadioGroup name="source_name" label="根拠" required options={SOURCE_OPTIONS} defaultValue={v.source_name ?? ""} error={e.source_name} />
        {text("source_url", "元のURL", { description: "https:// で始まるページのアドレス（任意）" })}
        {text("checked_on", "確かめた日", { type: "date", className: "w-48", description: "元のページと同じか確かめた日" })}
        <Checkbox name="is_active" value="1" label="使う" defaultChecked={(v.is_active ?? "") === "1"} />
      </section>

      {state.duplicate && <Checkbox name="force_duplicate" value="1" label="同じ質問がありますが、それでも保存する" />}

      <div className="flex justify-end">
        <SubmitButton pendingText="保存中…">保存する</SubmitButton>
      </div>
    </form>
  );
}
