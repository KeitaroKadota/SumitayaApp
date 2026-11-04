import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort } from "@/utils/format";
import { TEMPLATE_CATEGORIES, isTemplateCategory, purposeLabel } from "@/utils/replyTemplateRules";
import { listReplyTemplates } from "@/utils/replyTemplates";
import { Alert } from "@/components/Alert";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

// D-02 G02 返信のひな形の一覧(03 EV-06)。数十件の想定なので全件表示
export default async function ReplyTemplateListPage({ searchParams }: PageProps<"/admin/inquiries/templates">) {
  await requireAccess("inquiry_settings", "/admin/inquiries/templates");
  const params = await searchParams;
  const categoryRaw = str(params.category);
  const category = isTemplateCategory(categoryRaw) ? categoryRaw : null;
  const includeInactive = params.all === "1";
  const templates = await listReplyTemplates({ category, includeInactive });

  const createButton = (
    <LinkButton href="/admin/inquiries/templates/new" variant="primary">
      ＋ 新しく作る
    </LinkButton>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">返信のひな形</h1>
        {createButton}
      </div>
      {params.saved === "1" && <Alert tone="success">保存しました。</Alert>}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <Field id="category" label="種類">
          <AutoSubmitSelect id="category" name="category" defaultValue={category ?? ""} className="w-40">
            <option value="">すべて</option>
            {Object.entries(TEMPLATE_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </AutoSubmitSelect>
        </Field>
        <AutoSubmitCheckbox name="all" label="使わないものも出す" defaultChecked={includeInactive} />
      </form>

      {templates.length === 0 ? (
        <EmptyState
          message={category ? "条件に合うひな形はありません。" : "返信のひな形はまだありません。"}
          action={createButton}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">種類</th>
                <th className="px-3 py-2">用途</th>
                <th className="px-3 py-2">名前</th>
                <th className="px-3 py-2 text-center">使う</th>
                <th className="px-3 py-2">更新</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                  <td className="px-3 py-2 whitespace-nowrap">{TEMPLATE_CATEGORIES[t.category]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{purposeLabel(t.category, t.purpose)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/inquiries/templates/${t.id}`} className="font-bold text-primary hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-center">{t.isActive ? "○" : <span className="text-ink-muted">使わない</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatDateShort(t.updatedAt)} {t.updatedByName ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
