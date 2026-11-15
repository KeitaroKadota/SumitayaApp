import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { SLIP_STATUSES, formatSlipQuantity } from "@/utils/deliverySlipRules";
import { getSlipFiles, slipUrl } from "@/utils/deliverySlipServer";
import { formatDate, formatDateShort, formatDateTime, formatQuantity } from "@/utils/format";
import {
  RECEIVING_URL,
  getLinkedPoLines,
  getPoOptions,
  getReceivingLines,
  getReceivingSlip,
  matchSlip,
  receivingUrl,
} from "@/utils/receiving";
import {
  MATCH_RESULTS,
  MATCH_STATUSES,
  RECEIVING_RULES,
  isWithinCancelWindow,
  maxAcceptableOf,
  unitPriceExTaxOf,
  type MatchResult,
} from "@/utils/receivingMatch";
import { getSignedUrls } from "@/utils/storage";
import { Alert } from "@/components/Alert";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge, type BadgeTone } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { SlipPagesViewer } from "../SlipPagesViewer";
import { acceptReceiving, cancelReceiving, choosePurchaseOrder, fixReading, rematchSlip } from "../../../receiving/actions";
import { ReceivingForm, type ReceivingRow } from "./ReceivingForm";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

const DONE_MESSAGES: Record<string, string> = {
  confirmed: "確定しました。照合の結果を確かめてください。",
  rematched: "照合し直しました。",
  cancelled: "検収を取り消しました。CROSS MALL の在庫に入荷を入力していた場合は、元に戻してください。",
};
const ERROR_MESSAGES: Record<string, string> = {
  po: "選んだ発注は使えません（同じ仕入先の、発注済み・一部入荷の発注だけ選べます）。",
  status: "この納品書は、今の状態ではこの操作ができません。",
  save: "保存できませんでした。時間をおいてもう一度お試しください。",
  unconfirm: "確定を取り消せませんでした（ほかの人が更新したときは、画面を開き直してください）。",
  cancel_reason: "取消の理由を入力してください。",
  cancel_reason_long: `取消の理由は${RECEIVING_RULES.noteMax}文字以内で入力してください。`,
  cancel_status: "検収済みではないため取り消せません。",
  cancel_conflict: "ほかの人がこの納品書を更新しました。画面を開き直してください。",
  cancel_invoice: "請求書と結び付いているため取り消せません（E-04 で外してください）。",
  cancel_expired: `検収から${RECEIVING_RULES.cancelableDays}日を過ぎたため取り消せません（必要なら在庫の調整で直してください）。`,
  cancel_error: "検収を取り消せませんでした。時間をおいてもう一度お試しください。",
};

const RESULT_TONES: Record<MatchResult, BadgeTone> = {
  matched: "success",
  partial: "warning",
  over: "warning",
  price_diff: "danger",
  no_order_line: "warning",
  negative: "danger",
  non_stock: "neutral",
};

const yen = (n: number | null) => (n === null ? "" : formatQuantity(Math.round(n)));

// G02 照合の結果・検収(C-02 03 EV-02)。機能キー purchasing
export default async function ReceivingPage({
  params,
  searchParams,
}: {
  // (props の型は PageProps<"/admin/purchasing/slips/[id]/receiving"> と同じ形。型の生成〔next typegen〕の前でも通るように書いた)
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // 手順1
  const me = await requireAccess("purchasing", receivingUrl(id));
  const query = await searchParams;

  // 手順2
  let slip = await getReceivingSlip(id);
  if (!slip) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href={RECEIVING_URL} label="検収の一覧へ" />
        </div>
        <Alert tone="error">この納品書は見つかりません。</Alert>
      </div>
    );
  }
  // 手順3: 確定のまま(照合がまだ・失敗した・検収を取り消した)なら照合してから出す。
  // 【仮】画面を開いたときの照合では自動の検収はしない(C-02-仮-14)
  if (slip.status === "confirmed") {
    try {
      await matchSlip(id, { by: me.id, allowAuto: false });
    } catch (e) {
      console.error("納品書を照合できませんでした:", e instanceof Error ? e.message : e);
    }
    slip = (await getReceivingSlip(id)) ?? slip;
  }

  const done = DONE_MESSAGES[str(query.done)];
  const error = ERROR_MESSAGES[str(query.error)];
  const learned = Number(str(query.learned)) || 0;

  // 確かめ中・取消の納品書は照合しない(C-01 の画面へ)
  if (slip.status === "draft" || slip.status === "cancelled") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href={RECEIVING_URL} label="検収の一覧へ" />
        </div>
        <h1 className="text-2xl font-bold">照合の結果・検収</h1>
        {done && <Alert tone="success">{done}</Alert>}
        <Alert tone="info">
          この納品書は「{SLIP_STATUSES[slip.status]}」のため、照合・検収はできません。
          <Link href={slipUrl(id)} className="ml-1 font-bold text-primary hover:underline">
            納品書の確認へ
          </Link>
        </Alert>
      </div>
    );
  }

  const lines = await getReceivingLines(id);
  // 手順4: 発注の候補と、未納の発注の明細
  const accepted = slip.status === "accepted";
  const poOptions = accepted ? [] : await getPoOptions(slip, lines);
  const poLines = await getLinkedPoLines(slip.purchaseOrderId);
  // 手順5: ページの期限付きのURL(10分)
  const files = await getSlipFiles(slip.fileIds);
  const urls = await getSignedUrls(slip.fileIds);
  const pages = files.map((f) => ({ id: f.id, url: urls.get(f.id) ?? null, contentType: f.contentType, name: f.name }));

  const rows: ReceivingRow[] = lines.map((l) => {
    const units = l.unitsQuantity;
    const unitPrice = l.isNonStock ? null : unitPriceExTaxOf(l.amount, units, slip.taxIncluded, l.taxRate);
    const result = l.matchResult;
    const nonInteger = units !== null && !Number.isInteger(units);
    return {
      id: l.id,
      lineNo: l.lineNo,
      name: [l.productName ?? l.itemName, l.spec].filter(Boolean).join(" "),
      delivered: l.isNonStock ? "—" : units === null ? "" : `${formatSlipQuantity(units)}${nonInteger ? "（要確認）" : ""}`,
      deliveredNote:
        !l.isNonStock && l.packQuantity !== 1 && l.quantity !== null ? `${formatSlipQuantity(l.quantity)}${l.unit ?? ""}×${l.packQuantity}` : null,
      openQty: l.isNonStock || l.expectedQuantity === null ? "—" : formatQuantity(l.expectedQuantity),
      unitPrice: l.isNonStock ? yen(l.amount) : yen(unitPrice),
      orderUnitPrice: l.expectedUnitPrice === null ? "—" : yen(l.expectedUnitPrice),
      priceWarn: result === "price_diff",
      resultLabel: result ? (result === "matched" ? "✓一致" : MATCH_RESULTS[result]) : "未照合",
      resultTone: result ? RESULT_TONES[result] : "neutral",
      input: !l.isNonStock,
      // 既定は届いた数(整数にならない・マイナスのときは空。01 5.2、02 G02)
      defaultQty: units !== null && Number.isInteger(units) && units >= 0 ? String(maxAcceptableOf(units)) : "",
      acceptedQty: l.acceptedQuantity === null ? "" : formatQuantity(l.acceptedQuantity),
    };
  });
  // 納品書の側に無い発注の明細(まだ届いていない品)は「未納」として出すだけ(01 5.2)
  const usedPoLineIds = new Set(lines.map((l) => l.purchaseOrderLineId).filter(Boolean));
  if (!accepted) {
    for (const p of poLines) {
      if (usedPoLineIds.has(p.id) || p.openQty <= 0) continue;
      rows.push({
        id: null,
        lineNo: null,
        name: p.productName,
        delivered: "—",
        deliveredNote: null,
        openQty: formatQuantity(p.openQty),
        unitPrice: "",
        orderUnitPrice: yen(p.unitPrice),
        priceWarn: false,
        resultLabel: "未納（発注残）",
        resultTone: "neutral",
        input: false,
        defaultQty: "",
        acceptedQty: "",
      });
    }
  }

  const cancelable = accepted && !slip.receivedInvoiceId && isWithinCancelWindow(slip.acceptedAt);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href={RECEIVING_URL} label="検収の一覧へ" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">照合の結果・検収</h1>
        <Badge tone={accepted ? "success" : "warning"}>
          {accepted ? `検収済み${slip.matchStatus ? `（${MATCH_STATUSES[slip.matchStatus]}）` : ""}` : "要確認"}
        </Badge>
      </div>

      {done && <Alert tone="success">{done}</Alert>}
      {learned > 0 && <Alert tone="success">品番の対応表に{learned}件足しました。次から自動で選ばれます。</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">納品書の画像</h2>
          <SlipPagesViewer pages={pages} />
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
            <p>
              仕入先 <span className="font-bold">{slip.supplierName ?? "（不明）"}</span>
              <span className="ml-3">伝票 {slip.slipNo ?? "—"}</span>
              <span className="ml-3">納品日 {slip.deliveryDate ? formatDate(slip.deliveryDate) : "—"}</span>
            </p>
            <p className="text-ink-muted">
              合計 {slip.total === null ? "—" : `${formatQuantity(slip.total)}円`}（明細の金額は{slip.taxIncluded ? "税込" : "税抜"}。単価は自社の単位あたり・税抜）
            </p>
          </div>

          {/* EV-05 発注を選び直す */}
          {!accepted ? (
            <div className="flex flex-col gap-2">
              <form action={choosePurchaseOrder.bind(null, slip.id)} className="flex flex-wrap items-end gap-2">
                <Field id="purchase_order_id" label="発注">
                  <AutoSubmitSelect
                    id="purchase_order_id"
                    name="purchase_order_id"
                    defaultValue={slip.purchaseOrderId ?? ""}
                    className="w-96 max-w-full"
                  >
                    <option value="" disabled>
                      {poOptions.length === 0 ? "（同じ仕入先の発注済みの発注がありません）" : "発注を選んでください"}
                    </option>
                    {poOptions.map((o) => (
                      <option key={o.id} value={o.id} disabled={!o.open}>
                        {o.orderNo}（{o.orderDate ? `${formatDateShort(o.orderDate)}発注` : "発注日なし"}
                        {o.expectedDate ? `・予定 ${formatDateShort(o.expectedDate)}` : ""}）{o.open ? "" : "（検収できない状態）"}
                      </option>
                    ))}
                  </AutoSubmitSelect>
                </Field>
              </form>
              <form action={rematchSlip.bind(null, slip.id)}>
                <SubmitButton variant="secondary" pendingText="照合中…">
                  照合し直す
                </SubmitButton>
              </form>
            </div>
          ) : (
            <p className="text-sm">発注 {slip.purchaseOrderNo ?? "なし（発注なしで検収）"}</p>
          )}

          {!accepted && slip.reviewReasons.length > 0 && (
            <Alert tone="warning">理由: {slip.reviewReasons.join("／")}</Alert>
          )}
          {!accepted && slip.acceptNote && <p className="text-sm text-ink-muted">メモ: {slip.acceptNote}</p>}

          <ReceivingForm
            key={slip.version}
            action={acceptReceiving.bind(null, slip.id)}
            rows={rows}
            version={slip.version}
            readOnly={accepted}
            hasPurchaseOrder={Boolean(slip.purchaseOrderId)}
          />

          {/* EV-07 読み取りを直す(C-01 の確定の取消をして C-01 G03 へ) */}
          {!accepted && (
            <form action={fixReading.bind(null, slip.id)}>
              <input type="hidden" name="version" value={slip.version} />
              <ConfirmSubmitButton
                variant="secondary"
                confirmMessage="納品書の確定を取り消して、読み取りの確認の画面に戻ります。よいですか？"
                pendingText="取消中…"
              >
                読み取りを直す
              </ConfirmSubmitButton>
            </form>
          )}

          {/* 検収済みのとき: 検収した人・日時・理由と、EV-08 検収を取り消す */}
          {accepted && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 text-sm">
              <p>
                検収: {slip.acceptedByName ?? "自動"}・{slip.acceptedAt ? formatDateTime(slip.acceptedAt) : "—"}
              </p>
              {slip.acceptNote && <p>理由: {slip.acceptNote}</p>}
              {slip.receivedInvoiceId ? (
                <p className="text-ink-muted">請求書と結び付いているため、検収を取り消せません（E-04 で外してください）。</p>
              ) : !cancelable ? (
                <p className="text-ink-muted">検収から{RECEIVING_RULES.cancelableDays}日を過ぎたため、検収を取り消せません。</p>
              ) : (
                <form action={cancelReceiving.bind(null, slip.id)} className="flex flex-col gap-2">
                  <input type="hidden" name="version" value={slip.version} />
                  <Field id="cancel_reason" label="取消の理由" required>
                    <TextArea id="cancel_reason" name="cancel_reason" maxLength={RECEIVING_RULES.noteMax} required />
                  </Field>
                  <div className="flex justify-end">
                    <ConfirmSubmitButton confirmMessage="検収を取り消して、発注の入荷済みの数を元に戻します。よいですか？" pendingText="取消中…">
                      検収を取り消す
                    </ConfirmSubmitButton>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
