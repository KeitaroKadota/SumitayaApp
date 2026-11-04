"use client";

// D-03 G01 よくある質問への回答のパネル(03 EV-01〜EV-04)。D-01 の詳細画面(G04)の中に出す。
// 根拠にするFAQの印・探して足すのは画面の中だけで行い、「案を作る」で選んだFAQのIDをサーバーへ送る(サーバーで読み直す)。
import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { Button, buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";
import type { FaqPanelItem } from "@/utils/faq";
import { FAQ_LIMITS, FAQ_SOURCES, FAQ_TOPICS } from "@/utils/faqRules";
import { searchFaqForPanel } from "../faqReplyActions";

// 押したボタンの mode(ai・template)をフォームの値に入れて送る
function ModeButton({
  mode,
  variant,
  disabled,
  children,
}: {
  mode: "ai" | "template";
  variant: "primary" | "secondary";
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("mode") === mode;
  return (
    <button type="submit" name="mode" value={mode} disabled={pending || disabled} className={buttonClassName(variant)}>
      {mine ? "作成中…" : children}
    </button>
  );
}

export function FaqAnswerPanel({
  action,
  topics,
  initialItems,
  initialChecked,
  templates,
  aiStopped,
}: {
  action: (formData: FormData) => Promise<void>;
  // AIが見つけた話題(表示名)
  topics: string[];
  initialItems: FaqPanelItem[];
  initialChecked: string[];
  templates: { id: string; name: string }[];
  aiStopped: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initialChecked));
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FaqPanelItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  const toggle = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // EV-02 「探す」
  const search = () =>
    startSearch(async () => {
      setSearchError(null);
      try {
        const r = await searchFaqForPanel(q);
        if (r.ok) setResults(r.items);
        else {
          setResults(null);
          setSearchError(r.message);
        }
      } catch {
        setSearchError("探せませんでした。時間をおいてもう一度お試しください。");
      }
    });

  // 押すと根拠の一覧に足す(印を付ける)
  const add = (item: FaqPanelItem) => {
    setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
    toggle(item.id, true);
  };

  const count = checked.size;
  const countOk = count >= FAQ_LIMITS.selectedMin && count <= FAQ_LIMITS.selectedMax;

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">AIが見つけた話題:</span>
        {topics.length === 0 ? <span className="text-ink-muted">なし</span> : topics.map((t) => <Badge key={t} tone="ai">{t}</Badge>)}
      </p>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold">
          根拠にするFAQ（合いそうな順）
          <span className={`ml-2 font-normal tabular-nums ${countOk ? "text-ink-muted" : "text-danger"}`}>
            {count}件を選択（{FAQ_LIMITS.selectedMin}〜{FAQ_LIMITS.selectedMax}件）
          </span>
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-ink-muted">合いそうなよくある質問が見つかりません。下の「FAQを探す」から足してください。</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="faq_ids"
                    value={item.id}
                    checked={checked.has(item.id)}
                    onChange={(e) => toggle(item.id, e.currentTarget.checked)}
                    className="size-5 shrink-0 accent-primary"
                  />
                  <span className="w-16 shrink-0 text-ink-muted">{FAQ_TOPICS[item.topic]}</span>
                  <span className="min-w-0 flex-1 break-words">{item.question}</span>
                  <span className="shrink-0 text-ink-muted">{FAQ_SOURCES[item.sourceName]}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* EV-02 FAQを探す(この欄はフォームの値に入れない) */}
      <div className="flex flex-col gap-2 rounded-md border border-line p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="faq_search" label="FAQを探す" error={searchError ?? undefined}>
            <TextInput
              id="faq_search"
              value={q}
              maxLength={FAQ_LIMITS.searchText}
              onChange={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Enter で案を作らないように、探すだけにする
                if (e.key === "Enter") {
                  e.preventDefault();
                  search();
                }
              }}
              className="w-64"
            />
          </Field>
          <Button variant="secondary" disabled={searching} onClick={search}>
            {searching ? "探しています…" : "探す"}
          </Button>
        </div>
        {results &&
          (results.length === 0 ? (
            <p className="text-sm text-ink-muted">見つかりませんでした。</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((r) => {
                const added = items.some((i) => i.id === r.id) && checked.has(r.id);
                return (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="w-16 shrink-0 text-ink-muted">{FAQ_TOPICS[r.topic]}</span>
                    <span className="min-w-0 flex-1 break-words">{r.question}</span>
                    <Button variant="secondary" disabled={added} onClick={() => add(r)}>
                      {added ? "足しました" : "足す"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ))}
      </div>

      <Field id="faq_template_id" label="ひな形">
        <Select id="faq_template_id" name="template_id" defaultValue={templates[0]?.id ?? ""} className="w-72">
          {templates.length === 0 ? (
            <option value="">（ひな形がありません。FAQの回答を並べます）</option>
          ) : (
            templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))
          )}
        </Select>
      </Field>

      {!countOk && count > FAQ_LIMITS.selectedMax && (
        <Alert tone="warning">根拠にするよくある質問は{FAQ_LIMITS.selectedMax}件までにしてください。</Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <ModeButton mode="ai" variant="primary" disabled={!countOk || aiStopped}>
          AIで返信文の案を作る
        </ModeButton>
        <ModeButton mode="template" variant="secondary" disabled={!countOk}>
          ひな形で案を作る
        </ModeButton>
      </div>
      {aiStopped && <p className="text-sm text-ink-muted">AIが停止中のため、「ひな形で案を作る」を使ってください。</p>}
    </form>
  );
}
