"use client";

// G04 の返信欄の、案(draft)1件の枠(D-01 EV-10〜EV-13)。どの機能(D-02〜D-06・手書き)の案も同じ枠で出す。
// 実際の送信は楽楽自動応対・モールの画面で担当者が行う。「送信済みにする」は送ったという記録だけ。
import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { INQUIRY_LIMITS, INQUIRY_STATUSES, SENT_VIA, type SentVia } from "@/utils/inquiryRules";
import { markSent, saveReplyBody, type ReplyActionResult } from "../actions";

const AFTER_OPTIONS = [
  { value: "replied", label: INQUIRY_STATUSES.replied },
  { value: "waiting", label: INQUIRY_STATUSES.waiting },
  { value: "closed", label: INQUIRY_STATUSES.closed },
];
const initialResult: ReplyActionResult = { ok: true, message: "" };

export function ReplyDraftCard({
  replyId,
  initialBody,
  defaultSentVia,
  defaultAfterStatus = "replied",
  discardAction,
}: {
  replyId: string;
  initialBody: string;
  defaultSentVia: SentVia;
  // 送った後の状態の初めの値(D-04 の聞き返しは「お客様の返事待ち」)
  defaultAfterStatus?: "replied" | "waiting" | "closed";
  discardAction: () => Promise<void>;
}) {
  const [body, setBody] = useState(initialBody);
  const [savedBody, setSavedBody] = useState(initialBody);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [showSent, setShowSent] = useState(false);
  const [sentState, sentAction] = useActionState(markSent.bind(null, replyId), initialResult);
  const dirty = body !== savedBody;

  // EV-10 保存
  const save = async (): Promise<boolean> => {
    const result = await saveReplyBody(replyId, body);
    if (result.ok) setSavedBody(body);
    else setNotice({ tone: "error", text: result.message });
    return result.ok;
  };

  // EV-11 コピー: 保存していない変更があれば先に保存し、クリップボードに写す
  const copy = () => {
    startSaving(async () => {
      if (dirty && !(await save())) return;
      try {
        await navigator.clipboard.writeText(body);
        setNotice({ tone: "success", text: "コピーしました。楽楽自動応対（またはモールの画面）に貼り付けて送ってください。" });
      } catch {
        const el = document.getElementById(`reply-body-${replyId}`) as HTMLTextAreaElement | null;
        el?.focus();
        el?.select();
        setNotice({ tone: "info", text: "自動で写せませんでした。本文を選んだので、Ctrl+C で写してください。" });
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Field id={`reply-body-${replyId}`} label="返信文">
        <TextArea
          id={`reply-body-${replyId}`}
          rows={10}
          maxLength={INQUIRY_LIMITS.reply}
          value={body}
          onChange={(e) => {
            setBody(e.currentTarget.value);
            setNotice(null);
          }}
        />
      </Field>
      {dirty && <p className="text-sm text-warning">⚠ 保存していない変更があります。</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <form action={discardAction}>
          <SubmitButton variant="secondary" pendingText="保存中…">
            使わない
          </SubmitButton>
        </form>
        <Button
          variant="secondary"
          disabled={saving || !dirty}
          onClick={() =>
            startSaving(async () => {
              if (await save()) setNotice({ tone: "success", text: "保存しました。" });
            })
          }
        >
          {saving ? "保存中…" : "保存する"}
        </Button>
        <Button variant="secondary" disabled={saving} onClick={copy}>
          コピーする
        </Button>
        <Button variant="primary" onClick={() => setShowSent((s) => !s)} aria-expanded={showSent}>
          送信済みにする…
        </Button>
      </div>

      {showSent && (
        <form action={sentAction} className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface p-4">
          {!sentState.ok && sentState.message && <Alert tone="error">{sentState.message}</Alert>}
          <p className="text-sm text-ink-muted">
            楽楽自動応対・モールの画面で送った後に記録してください。このボタンではお客様に送りません。
          </p>
          <input type="hidden" name="body" value={body} />
          <Field id={`sent-via-${replyId}`} label="送った画面">
            <Select id={`sent-via-${replyId}`} name="sent_via" defaultValue={defaultSentVia} className="max-w-xs">
              {Object.entries(SENT_VIA).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <RadioGroup name="after_status" label="送った後の状態" options={AFTER_OPTIONS} defaultValue={defaultAfterStatus} required />
          <div className="flex justify-end">
            <SubmitButton pendingText="記録中…">送信済みとして記録する</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
