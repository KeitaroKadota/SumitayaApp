import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { saveReplyTemplate } from "../actions";
import { TemplateForm } from "../TemplateForm";

// D-02 G03 返信のひな形の新規(編集と同じ画面。03 EV-07)
export default async function NewReplyTemplatePage() {
  await requireAccess("inquiry_settings", "/admin/inquiries/templates/new");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries/templates" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">ひな形の新規作成</h1>
      <TemplateForm action={saveReplyTemplate.bind(null, null)} initialValues={{ sort_order: "0", is_active: "1" }} />
    </div>
  );
}
