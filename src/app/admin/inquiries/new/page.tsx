import { requireAccess } from "@/utils/auth";
import { formatDateTime } from "@/utils/format";
import { getAiUsage } from "@/utils/gemini";
import { nowISO } from "@/utils/jst";
import { AiUsageNotice } from "@/components/AiUsageNotice";
import { BackLink } from "@/components/LinkButton";
import { InquiryImportForm } from "./InquiryImportForm";

// 取り込みの後に AIで種類を見分ける(最大30秒)ため、操作の最大時間を60秒にする
export const maxDuration = 60;

// G02 問い合わせの取り込み(貼り付け)(D-01 EV-02)
export default async function NewInquiryPage() {
  await requireAccess("inquiries", "/admin/inquiries/new");
  // 手順2: 停止中・残りわずかなら「AIで種類を見分ける」を外す(停止中は押せない)
  const usage = await getAiUsage();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">問い合わせを貼り付けて取り込む</h1>
      <AiUsageNotice usage={usage} />
      <InquiryImportForm
        // 手順1: 受信日時の初めの値は今
        defaultReceivedAt={formatDateTime(nowISO())}
        aiState={usage.state}
      />
    </div>
  );
}
