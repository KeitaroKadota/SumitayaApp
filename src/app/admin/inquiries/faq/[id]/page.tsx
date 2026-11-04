import { requireAccess } from "@/utils/auth";
import { getFaqEntry } from "@/utils/faq";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { saveFaq } from "../actions";
import { FaqForm } from "../FaqForm";

// D-03 G03 よくある質問の編集(03 EV-06)
export default async function FaqEditPage({ params }: PageProps<"/admin/inquiries/faq/[id]">) {
  const { id } = await params;
  await requireAccess("inquiry_settings", `/admin/inquiries/faq/${id}`);

  const faq = await getFaqEntry(id);
  if (!faq) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/inquiries/faq" label="一覧へ" />
        </div>
        <Alert tone="error">このよくある質問は見つかりません。</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries/faq" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">よくある質問の編集</h1>
      <FaqForm
        key={faq.id}
        action={saveFaq.bind(null, faq.id)}
        initialValues={{
          topic: faq.topic,
          sort_order: String(faq.sortOrder),
          question: faq.question,
          answer: faq.answer,
          keywords: faq.keywords ?? "",
          source_name: faq.sourceName,
          source_url: faq.sourceUrl ?? "",
          checked_on: faq.checkedOn ?? "",
          is_active: faq.isActive ? "1" : "",
        }}
      />
    </div>
  );
}
