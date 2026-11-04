"use client";

// G02 問い合わせの取り込みのフォーム(D-01 EV-02・EV-03、04 CH-01〜CH-05)。
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { INQUIRY_CHANNELS, INQUIRY_LIMITS } from "@/utils/inquiryRules";
import type { AiUsageState } from "@/utils/gemini";
import { findParentCandidates, importInquiry, type ImportState } from "../actions";

const initialState: ImportState = { errors: {}, formError: null, values: {}, duplicate: null };
const CHANNEL_OPTIONS = Object.entries(INQUIRY_CHANNELS).map(([value, label]) => ({ value, label }));
const RECEIVED_DESCRIPTION = "楽楽自動応対・モールの受信時刻を「2026/11/20 09:12」の形で入れてください。";
const EXTERNAL_DESCRIPTION = "楽楽自動応対・モールの番号（任意）。同じ番号の二重の取り込みを防ぎます。";

export function InquiryImportForm({ defaultReceivedAt, aiState }: { defaultReceivedAt: string; aiState: AiUsageState }) {
  const [state, formAction] = useActionState(importInquiry, initialState);
  const v = (name: string, fallback = "") => state.values[name] ?? fallback;
  const [candidates, setCandidates] = useState<{ value: string; label: string }[]>([]);
  const [loadingCandidates, startTransition] = useTransition();

  // EV-02 手順3: メールアドレスを入れたら、同じアドレスの直近の問い合わせを候補に出す
  const loadCandidates = (email: string) => {
    startTransition(async () => {
      setCandidates(email.trim() ? await findParentCandidates(email) : []);
    });
  };

  const aiStopped = aiState === "stopped";
  const classifyDefault = state.values.classify !== undefined ? state.values.classify === "1" : aiState === "available";

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      {state.formError && (
        <Alert tone={state.duplicate ? "warning" : "error"}>
          {state.formError}
          {state.duplicate && (
            <>
              {" "}
              <Link href={`/admin/inquiries/${state.duplicate.id}`} className="font-bold underline" target="_blank">
                その問い合わせを開く
              </Link>
            </>
          )}
        </Alert>
      )}

      <RadioGroup
        name="channel"
        label="経路"
        options={CHANNEL_OPTIONS}
        defaultValue={v("channel", "email")}
        required
        error={state.errors.channel}
      />

      <Field id="received_at" label="受信日時" required description={RECEIVED_DESCRIPTION} error={state.errors.received_at}>
        <TextInput
          id="received_at"
          name="received_at"
          defaultValue={v("received_at", defaultReceivedAt)}
          placeholder="例: 2026/11/20 09:12"
          className="max-w-xs"
          invalid={!!state.errors.received_at}
          aria-describedby={fieldDescribedBy("received_at", { description: RECEIVED_DESCRIPTION, error: state.errors.received_at })}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
        <Field id="customer_name" label="お客様の名前" error={state.errors.customer_name}>
          <TextInput
            id="customer_name"
            name="customer_name"
            maxLength={INQUIRY_LIMITS.customerName}
            defaultValue={v("customer_name")}
            placeholder="例: 山田 太郎"
            invalid={!!state.errors.customer_name}
            aria-describedby={fieldDescribedBy("customer_name", { error: state.errors.customer_name })}
          />
        </Field>
        <Field id="customer_email" label="メールアドレス" error={state.errors.customer_email}>
          <TextInput
            id="customer_email"
            name="customer_email"
            type="email"
            maxLength={INQUIRY_LIMITS.email}
            defaultValue={v("customer_email")}
            onBlur={(e) => loadCandidates(e.currentTarget.value)}
            invalid={!!state.errors.customer_email}
            aria-describedby={fieldDescribedBy("customer_email", { error: state.errors.customer_email })}
          />
        </Field>
      </div>

      <Field id="subject" label="件名" error={state.errors.subject}>
        <TextInput
          id="subject"
          name="subject"
          maxLength={INQUIRY_LIMITS.subject}
          defaultValue={v("subject")}
          invalid={!!state.errors.subject}
          aria-describedby={fieldDescribedBy("subject", { error: state.errors.subject })}
        />
      </Field>

      <Field id="external_id" label="問い合わせ番号" description={EXTERNAL_DESCRIPTION} error={state.errors.external_id}>
        <TextInput
          id="external_id"
          name="external_id"
          maxLength={INQUIRY_LIMITS.externalId}
          defaultValue={v("external_id")}
          className="max-w-xs"
          invalid={!!state.errors.external_id}
          aria-describedby={fieldDescribedBy("external_id", { description: EXTERNAL_DESCRIPTION, error: state.errors.external_id })}
        />
      </Field>

      <Field id="body" label="本文" required error={state.errors.body}>
        <TextArea
          id="body"
          name="body"
          rows={12}
          maxLength={INQUIRY_LIMITS.body}
          defaultValue={v("body")}
          placeholder="メール・メッセージの本文をそのまま貼り付けてください。"
          invalid={!!state.errors.body}
          aria-describedby={fieldDescribedBy("body", { error: state.errors.body })}
        />
      </Field>

      <Field
        id="parent_inquiry_id"
        label="続きのメッセージ"
        description={
          loadingCandidates
            ? "読み込み中…"
            : "前の問い合わせの続きなら選んでください（任意）。メールアドレスを入れると候補が出ます。"
        }
        error={state.errors.parent_inquiry_id}
      >
        <Select id="parent_inquiry_id" name="parent_inquiry_id" defaultValue={v("parent_inquiry_id")}>
          <option value="">（新しい問い合わせ）</option>
          {candidates.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex flex-col">
        <Checkbox
          name="classify"
          value="1"
          label="取り込んだらAIで種類を見分ける"
          defaultChecked={!aiStopped && classifyDefault}
          disabled={aiStopped}
        />
        {aiStopped && <p className="text-sm text-ink-muted">AIが停止中のため選べません。種類は取り込んだ後に手で選んでください。</p>}
      </div>

      {state.duplicate && (
        <Checkbox name="force_duplicate" value="1" label="同じ内容の問い合わせがありますが、それでも取り込む" />
      )}

      <div className="flex justify-end">
        <SubmitButton pendingText="取り込み中…">取り込む</SubmitButton>
      </div>
    </form>
  );
}
