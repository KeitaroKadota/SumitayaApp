import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { listFaqEntries } from "@/utils/faq";
import { FAQ_SOURCES, FAQ_TOPICS, isFaqTopic } from "@/utils/faqRules";
import { formatDateShort, formatQuantity } from "@/utils/format";
import { Alert } from "@/components/Alert";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Select } from "@/components/Select";
import { TextInput } from "@/components/TextInput";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

// D-03 G02 よくある質問の一覧(03 EV-05)。数十〜数百件の想定なので全件表示
export default async function FaqListPage({ searchParams }: PageProps<"/admin/inquiries/faq">) {
  await requireAccess("inquiry_settings", "/admin/inquiries/faq");
  const params = await searchParams;
  const topicRaw = str(params.topic);
  const topic = isFaqTopic(topicRaw) ? topicRaw : null;
  const q = str(params.q).trim().slice(0, 100);
  const includeInactive = params.all === "1";
  const entries = await listFaqEntries({ topic, q, includeInactive });

  // 保存・取り込みの後の文(EV-06 手順4・EV-07 手順3)
  const imported = str(params.imported).match(/^(\d+),(\d+)$/);
  const done =
    params.saved === "1"
      ? "保存しました。"
      : imported
        ? `${formatQuantity(Number(imported[1]) + Number(imported[2]))}件を登録しました（新規 ${formatQuantity(Number(imported[1]))}件・更新 ${formatQuantity(Number(imported[2]))}件）。`
        : null;

  const actions = (
    <>
      <LinkButton href="/admin/inquiries/faq/new" variant="primary">
        ＋ 新しく作る
      </LinkButton>
      <LinkButton href="/admin/inquiries/faq/import">CSVで取り込む</LinkButton>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">よくある質問</h1>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      {done && <Alert tone="success">{done}</Alert>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="topic" label="話題">
          <Select id="topic" name="topic" defaultValue={topic ?? ""} className="w-40">
            <option value="">すべて</option>
            {Object.entries(FAQ_TOPICS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="q" label="検索">
          <TextInput id="q" name="q" defaultValue={q} placeholder="質問・回答・ことば" className="w-72" />
        </Field>
        <AutoSubmitCheckbox name="all" label="使わないものも出す" defaultChecked={includeInactive} />
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>

      {entries.length === 0 ? (
        <EmptyState
          message={q || topic ? "条件に合うよくある質問はありません。" : "よくある質問はまだありません。"}
          action={<div className="flex flex-wrap justify-center gap-2">{actions}</div>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">話題</th>
                <th className="px-3 py-2">質問</th>
                <th className="px-3 py-2">根拠</th>
                <th className="px-3 py-2">確かめた日</th>
                <th className="px-3 py-2 text-center">使う</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((f) => (
                <tr key={f.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                  <td className="px-3 py-2 whitespace-nowrap">{FAQ_TOPICS[f.topic]}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/inquiries/faq/${f.id}`} className="font-bold text-primary hover:underline">
                      {f.question}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{FAQ_SOURCES[f.sourceName]}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{f.checkedOn ? formatDateShort(f.checkedOn) : ""}</td>
                  <td className="px-3 py-2 text-center">{f.isActive ? "○" : <span className="text-ink-muted">使わない</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
