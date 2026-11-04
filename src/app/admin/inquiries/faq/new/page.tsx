import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { saveFaq } from "../actions";
import { FaqForm } from "../FaqForm";

// D-03 G03 よくある質問の新規(編集と同じ画面。03 EV-06)
export default async function NewFaqPage() {
  await requireAccess("inquiry_settings", "/admin/inquiries/faq/new");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries/faq" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">よくある質問の新規作成</h1>
      <FaqForm action={saveFaq.bind(null, null)} initialValues={{ sort_order: "0", source_name: "site", is_active: "1" }} />
    </div>
  );
}
