import { requireAccess } from "@/utils/auth";
import { getReplyTemplate } from "@/utils/replyTemplates";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { saveReplyTemplate } from "../actions";
import { TemplateForm } from "../TemplateForm";

// D-02 G03 返信のひな形の編集(03 EV-07)
export default async function ReplyTemplateEditPage({ params }: PageProps<"/admin/inquiries/templates/[id]">) {
  const { id } = await params;
  await requireAccess("inquiry_settings", `/admin/inquiries/templates/${id}`);

  const template = await getReplyTemplate(id);
  if (!template) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/inquiries/templates" label="一覧へ" />
        </div>
        <Alert tone="error">このひな形は見つかりません。</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries/templates" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">ひな形の編集</h1>
      <TemplateForm
        key={template.id}
        action={saveReplyTemplate.bind(null, template.id)}
        initialValues={{
          category: template.category,
          purpose: template.purpose,
          name: template.name,
          sort_order: String(template.sortOrder),
          subject: template.subject ?? "",
          body: template.body,
          is_active: template.isActive ? "1" : "",
        }}
      />
    </div>
  );
}
