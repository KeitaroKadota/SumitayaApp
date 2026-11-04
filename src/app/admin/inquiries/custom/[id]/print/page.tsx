import { requireAccess } from "@/utils/auth";
import { factoryRequestMissing } from "@/utils/customQuote";
import { formatDate } from "@/utils/format";
import { UUID_PATTERN } from "@/utils/inquiries";
import { todayJST } from "@/utils/jst";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { PrintButton } from "@/components/PrintButton";
import { listAllPriceItems } from "../../../price-items/priceItemData";
import { getQuote } from "../../quoteData";
import { factorySummaryRows } from "../../quoteText";

// D-04 G03 工場への見積依頼(印刷用。03 EV-10)。お客様のメールアドレス・電話番号は出さない。
// 印刷用のページ(/print で終わるURL)なので左メニューは出さない(00_画面共通ルール 9章)。タスク・通知は出さない
export default async function FactoryRequestPrintPage({ params }: PageProps<"/admin/inquiries/custom/[id]/print">) {
  const { id } = await params;
  await requireAccess("inquiries", `/admin/inquiries/custom/${id}/print`);
  const quote = UUID_PATTERN.test(id) ? await getQuote(id) : null;
  const back = (
    <div className="print:hidden">
      <BackLink href={quote ? `/admin/inquiries/custom/${quote.id}` : "/admin/inquiries/custom"} label="案件へ" />
    </div>
  );
  if (!quote) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Alert tone="error">この案件は見つかりません。</Alert>
      </div>
    );
  }

  // 手順1: CH-11 依頼に必要な項目
  const missing = factoryRequestMissing(quote.spec);
  if (missing.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Alert tone="error">工場に依頼するには、次の項目を入れてください: {missing.join("・")}</Alert>
      </div>
    );
  }

  // 手順2・3
  const rows = factorySummaryRows(quote, await listAllPriceItems());
  const requestedOn = quote.factoryRequestedAt ?? todayJST();
  return (
    <div className="flex flex-col gap-4">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        {back}
        <PrintButton />
      </div>
      <article className="mx-auto w-full max-w-[210mm] bg-white p-8 text-ink shadow print:max-w-none print:p-0 print:shadow-none">
        <h1 className="mb-4 text-xl font-bold">工場への見積依頼</h1>
        <p className="mb-4 text-sm">依頼日 {formatDate(requestedOn)}</p>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border border-line">
                <th className="w-36 bg-canvas px-3 py-2 text-left align-top font-bold [print-color-adjust:exact]">{r.label}</th>
                <td className="px-3 py-2 whitespace-pre-wrap break-words">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}
