// G02 納品書を撮る・上げる(スマホ。PCでも使える。C-01 03 EV-04)。機能キー purchasing(社長・店舗・経理)。
// ページを選ぶとすぐに保存し、「上げて読み取る」で納品書を作って AI で読み取る。終わったら G03(確認・修正)へ移る。
import { fullName, requireAccess } from "@/utils/auth";
import { CAPTURE_URL } from "@/utils/deliverySlipServer";
import { getAiUsage } from "@/utils/gemini";
import { listActiveSuppliers } from "@/utils/masters";
import { isStorageConfigured } from "@/utils/storage";
import { AiUsageNotice } from "@/components/AiUsageNotice";
import { BackLink } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { createDeliverySlip, slipDuplicateNote } from "../actions";
import { SlipCapture } from "./SlipCapture";

// 「上げて読み取る」は AI の読み取り(55秒で打ち切り)を待つので、操作の時間の上限を60秒にする(01 10章)
export const maxDuration = 60;

export default async function NewDeliverySlipPage() {
  // 手順1
  const me = await requireAccess("purchasing", CAPTURE_URL);
  // 手順2: 仕入先の候補(使用中のもの)
  const suppliers = await listActiveSuppliers();
  // 手順3: 保存先の設定
  const configured = isStorageConfigured();
  // 今日のAIの残り回数(01 7.4)
  const usage = await getAiUsage();

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href="/" label="ホーム" />
        </div>
        <h1 className="text-xl font-bold">納品書を撮る</h1>
        <AiUsageNotice usage={usage} />
        {usage.state === "stopped" && (
          <p className="text-sm text-ink-muted">AIを使えないときは、上げたあとに画像を見ながら手で入力できます。</p>
        )}
        <SlipCapture
          action={createDeliverySlip}
          duplicateNote={slipDuplicateNote}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          configured={configured}
          endpoint="/purchasing/slips/files"
        />
      </main>
    </>
  );
}
