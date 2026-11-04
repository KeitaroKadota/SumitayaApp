import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { FAQ_CSV_COLUMNS } from "@/utils/faqCsv";
import { FaqImportForm } from "./FaqImportForm";

// D-03 G04 よくある質問のCSV取り込み(03 EV-07。A-01 の共通の「確認→登録」の2段階)
export default async function FaqImportPage() {
  await requireAccess("inquiry_settings", "/admin/inquiries/faq/import");
  const columns = Object.values(FAQ_CSV_COLUMNS)
    .map((c) => c[0])
    .join("・");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries/faq" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">よくある質問のCSV取り込み</h1>
      <FaqImportForm
        columnsText={`列: ${columns}。話題・質問・回答・根拠は必須です。ID が空なら新規、入っていれば更新します。`}
      />
    </div>
  );
}
