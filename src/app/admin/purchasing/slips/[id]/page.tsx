import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { READ_STATUSES, SLIP_STATUSES, confirmBlockers, formatSlipQuantity } from "@/utils/deliverySlipRules";
import { ITEM_CODES_URL, SLIPS_URL, findConfirmedDuplicates, getSlip, getSlipFiles, slipUrl } from "@/utils/deliverySlipServer";
import { formatDate, formatDateShort, formatDateTime } from "@/utils/format";
import { getAiUsage } from "@/utils/gemini";
import { todayJST } from "@/utils/jst";
import { listActiveSuppliers } from "@/utils/masters";
import { receivingUrl } from "@/utils/receiving";
import { getSignedUrls } from "@/utils/storage";
import { AiUsageNotice } from "@/components/AiUsageNotice";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { BackLink } from "@/components/LinkButton";
import { SubmitButton } from "@/components/SubmitButton";
import { cancelDeliverySlip, confirmDeliverySlip, rereadDeliverySlip, saveDeliverySlip, unconfirmDeliverySlip } from "../actions";
import { AutoRefresh } from "./AutoRefresh";
import { SlipPagesViewer } from "./SlipPagesViewer";
import { SlipReviewForm, type ReviewSlipLine } from "./SlipReviewForm";

// 「もう一度AIで読み取る」は AI の読み取り(55秒で打ち切り)を待つので、操作の時間の上限を60秒にする(01 10章)
export const maxDuration = 60;

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const val = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

const DONE_MESSAGES: Record<string, string> = {
  saved: "保存しました。",
  confirmed: "確定しました。",
  cancelled: "取り消しました。",
  unconfirmed: "確定を取り消しました。直してからもう一度確定してください。",
};
const ERROR_MESSAGES: Record<string, string> = {
  conflict: "ほかの人がこの納品書を更新しました。画面を開き直してください。",
  status: "この納品書は、今の状態ではこの操作ができません。",
  busy: "読み取りできない状態です（読み取り中か、確かめ中ではありません）。",
  save: "保存できませんでした。時間をおいてもう一度お試しください。",
  confirm: "確定できませんでした。下の「確定するには」の点を直してから、もう一度「確定する」を押してください。",
  cancel: "取り消せない状態です（確かめ中・確定の納品書だけ取り消せます）。",
  unconfirm: "確定を取り消せませんでした。検収済みのときは、C-02 で検収を取り消してください（ほかの人が更新したときは、画面を開き直してください）。",
};
const MANUAL_MESSAGE = "AIの読み取りを使えませんでした（今日の回数の上限、または読み取りの失敗）。画像を見ながら入力してください。";

// G03 読み取り結果の確認・修正(C-01 03 EV-07)。機能キー purchasing
export default async function DeliverySlipPage({
  params,
  searchParams,
}: {
  // (props の型は PageProps<"/admin/purchasing/slips/[id]"> と同じ形。型の生成〔next typegen〕の前でも通るように書いた)
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // 手順1
  await requireAccess("purchasing", slipUrl(id));
  const query = await searchParams;

  // 手順2: 伝票と明細
  const loaded = await getSlip(id);
  if (!loaded) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href={SLIPS_URL} label="一覧へ" />
        </div>
        <Alert tone="error">この納品書は見つかりません。</Alert>
      </div>
    );
  }
  const { slip, lines } = loaded;

  // 手順3: ページの期限付きのURL(10分)
  const files = await getSlipFiles(slip.fileIds);
  const urls = await getSignedUrls(slip.fileIds);
  const pages = files.map((f) => ({ id: f.id, url: urls.get(f.id) ?? null, contentType: f.contentType, name: f.name }));

  // 手順4: 仕入先の候補(取引停止の仕入先が入っていれば、それも出す)・AIの残り回数
  const suppliers = (await listActiveSuppliers()).map((s) => ({ id: s.id, name: s.name }));
  if (slip.supplierId && !suppliers.some((s) => s.id === slip.supplierId))
    suppliers.unshift({ id: slip.supplierId, name: `${slip.supplierName ?? "（仕入先）"}（取引停止）` });
  const usage = await getAiUsage();

  const draft = slip.status === "draft";
  // 手順5: 読み取り中のままなら「読み取り中…」を出し、数秒ごとに画面を新しくする(2分たったら止まったとみなす)
  const reading = slip.readStatus === "reading";
  const readOnly = !draft || reading;
  const blockers = draft && !reading ? confirmBlockers(slip, lines) : [];

  const done = DONE_MESSAGES[str(query.done)];
  const error = ERROR_MESSAGES[str(query.error)];
  const learned = Number(str(query.learned)) || 0;
  const read = str(query.read);
  const prompt = draft ? str(query.prompt) : "";
  const duplicates = prompt === "duplicate" ? await findConfirmedDuplicates(slip.id, slip) : [];
  const aiNotes =
    slip.aiResult && typeof slip.aiResult === "object" && typeof (slip.aiResult as { notes?: unknown }).notes === "string"
      ? ((slip.aiResult as { notes: string }).notes as string)
      : null;

  const initialValues: Record<string, string> = {
    supplier_id: val(slip.supplierId),
    supplier_name_read: val(slip.supplierNameRead),
    slip_no: val(slip.slipNo),
    delivery_date: val(slip.deliveryDate),
    order_ref: val(slip.orderRef),
    tax_included: slip.taxIncluded ? "1" : "0",
    subtotal: val(slip.subtotal),
    tax: val(slip.tax),
    total: val(slip.total),
    note: val(slip.note),
  };
  const initialLines: ReviewSlipLine[] = lines.map((l) => ({
    key: l.id,
    id: l.id,
    code: val(l.supplierItemCode),
    name: l.itemName,
    spec: val(l.spec),
    qty: l.quantity === null ? "" : formatSlipQuantity(l.quantity).replace(/,/g, ""),
    unit: val(l.unit),
    price: val(l.unitPrice),
    amount: val(l.amount),
    product: val(l.productCode),
    productName: l.productName,
    productFromMap: Boolean(l.productId) && !l.isEdited,
    nonstock: l.isNonStock,
    confidence: l.confidence,
    isEdited: l.isEdited,
    flags: l.checkFlags,
  }));

  return (
    <div className="flex flex-col gap-4">
      {reading && !slip.readingStale && <AutoRefresh />}
      <div>
        <BackLink href={SLIPS_URL} label="一覧へ" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">納品書の確認</h1>
        <span className={slip.status === "cancelled" ? "line-through" : ""}>
          <Badge tone={draft ? "warning" : "neutral"}>{SLIP_STATUSES[slip.status]}</Badge>
        </span>
        <Badge tone="neutral">読み取り: {READ_STATUSES[slip.readStatus]}</Badge>
        {slip.needsCheck && <Badge tone="warning">⚠ 要確認</Badge>}
      </div>

      {done && <Alert tone="success">{done}</Alert>}
      {learned > 0 && <Alert tone="success">品番の対応表に{learned}件足しました。次から自動で選ばれます。</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {reading && !slip.readingStale && <Alert tone="info">読み取り中…（10〜30秒かかります）</Alert>}
      {reading && slip.readingStale && (
        <Alert tone="warning">読み取りが止まったようです。「もう一度AIで読み取る」を押してください。</Alert>
      )}
      {draft && (slip.readStatus === "manual" || slip.readStatus === "failed" || read === "manual" || read === "failed") && (
        <Alert tone="warning">{MANUAL_MESSAGE}</Alert>
      )}
      {aiNotes && draft && <Alert tone="info">AIからの注意: {aiNotes}</Alert>}

      {/* EV-10 手順3・4 の確認(保存のあとに出す) */}
      {prompt === "arithmetic" && (
        <Alert tone="warning">
          <p>計算が合わない項目があります。伝票のとおりなら、このまま確定してください。</p>
          <form action={confirmDeliverySlip.bind(null, slip.id)} className="mt-2 flex gap-2">
            <input type="hidden" name="version" value={slip.version} />
            <input type="hidden" name="accept_arithmetic" value="1" />
            <SubmitButton variant="primary" pendingText="確定中…">
              このまま確定
            </SubmitButton>
          </form>
        </Alert>
      )}
      {prompt === "duplicate" && duplicates.length > 0 && (
        <Alert tone="warning">
          <p>
            同じ伝票番号の納品書がすでに確定されています（
            {duplicates.map((d) => (d.deliveryDate ? formatDateShort(d.deliveryDate) : "納品日なし")).join("、")}）。
          </p>
          <ul className="mt-1">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={slipUrl(d.id)} className="font-bold text-primary hover:underline">
                  その納品書を開く
                </Link>
              </li>
            ))}
          </ul>
          <form action={confirmDeliverySlip.bind(null, slip.id)} className="mt-2 flex gap-2">
            <input type="hidden" name="version" value={slip.version} />
            <input type="hidden" name="force_duplicate" value="1" />
            {str(query.accepted) === "arithmetic" && <input type="hidden" name="accept_arithmetic" value="1" />}
            <SubmitButton variant="primary" pendingText="確定中…">
              このまま確定
            </SubmitButton>
          </form>
        </Alert>
      )}
      {slip.status === "cancelled" && <Alert tone="info">この納品書は取り消しました（画像は残してあります）。</Alert>}
      {!draft && slip.status !== "cancelled" && slip.confirmedAt && (
        <p className="text-sm">
          <Badge tone="success">
            確定（{slip.confirmedByName ?? "−"}・{formatDateTime(slip.confirmedAt)}）
          </Badge>
          {/* C-02 G02 照合の結果・検収へ */}
          <Link href={receivingUrl(slip.id)} className="ml-2 font-bold text-primary hover:underline">
            照合の結果・検収を見る
          </Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">画像</h2>
          <SlipPagesViewer pages={pages} />
          {draft && (
            <form action={rereadDeliverySlip.bind(null, slip.id)} className="flex flex-col gap-2">
              <input type="hidden" name="version" value={slip.version} />
              <div>
                <ConfirmSubmitButton
                  variant="secondary"
                  confirmMessage="直した内容は消え、読み取り直した結果で置き換わります。よいですか？"
                  pendingText="読み取り中…"
                  disabled={reading && !slip.readingStale}
                >
                  もう一度AIで読み取る
                </ConfirmSubmitButton>
              </div>
              <AiUsageNotice usage={usage} />
            </form>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="font-bold">読み取り結果{draft ? "（AIが読んだ値。違えば直してください）" : ""}</h2>
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
            <SlipReviewForm
              key={slip.version}
              action={saveDeliverySlip.bind(null, slip.id)}
              initialValues={initialValues}
              initialLines={initialLines}
              headerFlags={slip.checkFlags}
              suppliers={suppliers}
              version={slip.version}
              readOnly={readOnly}
              slipConfidence={slip.confidence}
              hasAiResult={slip.aiResult !== null}
              today={todayJST()}
            />
          </div>
          {blockers.length > 0 && (
            <div className="text-sm text-ink-muted">
              <p>確定するには、次を直してください:</p>
              <ul className="list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-ink-muted">
            登録: {formatDate(slip.createdAt)}
            <Link href={ITEM_CODES_URL} className="font-bold text-primary hover:underline">
              品番の対応表を見る
            </Link>
          </p>
        </section>
      </div>

      {/* EV-11 取消・確定の取消(CH-12) */}
      {(slip.status === "draft" || slip.status === "confirmed" || slip.status === "needs_review") && !reading && (
        <div className="flex flex-wrap justify-end gap-2 rounded-lg border border-line bg-surface p-4">
          {(slip.status === "confirmed" || slip.status === "needs_review") && (
            <form action={unconfirmDeliverySlip.bind(null, slip.id)}>
              <input type="hidden" name="version" value={slip.version} />
              <ConfirmSubmitButton variant="secondary" confirmMessage="確定を取り消して、確かめ中に戻します。よいですか？" pendingText="取消中…">
                確定を取り消す
              </ConfirmSubmitButton>
            </form>
          )}
          {(slip.status === "draft" || slip.status === "confirmed") && (
            <form action={cancelDeliverySlip.bind(null, slip.id)}>
              <input type="hidden" name="version" value={slip.version} />
              <ConfirmSubmitButton confirmMessage="この納品書を取り消してよいですか？（画像は残ります）" pendingText="取消中…">
                取消
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
