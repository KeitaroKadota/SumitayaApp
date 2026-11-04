import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatDateTime, formatQuantity, formatYearMonth, formatYen } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { accountLabel, checkMatch, daysBetween, FEE_MAX, MAX_IGNORE_MEMO } from "@/utils/deposits";
import {
  candidatesForDeposits,
  countDepositsByStatus,
  getDeposit,
  getLastImport,
  isTargetAccount,
  isUuid,
  listBankAccounts,
  listDeposits,
  listOpenInvoiceCustomers,
  listOpenInvoices,
  listSelectableInvoices,
  SELECT_INVOICES_LIMIT,
  type BankAccount,
  type Deposit,
  type OpenInvoice,
} from "@/utils/depositsServer";
import { invoiceUrl } from "@/utils/invoicesServer";
import { Alert } from "@/components/Alert";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { Modal } from "@/components/Modal";
import { PeriodNav } from "@/components/PeriodNav";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { cancelImportAction, ignoreDepositAction, matchDepositAction, removeMatchAction, restoreDepositAction } from "./actions";
import { BackFields, IgnoreButton, SelectInvoiceForm, type SelectableInvoice } from "./DepositForms";
import {
  ACCOUNTS_URL,
  DEPOSITS_TABS,
  DEPOSITS_URL,
  IMPORT_URL,
  depositsUrl,
  isDepositsTab,
  isMonthStr,
  shiftMonth,
  type DepositsQuery,
  type DepositsTab,
} from "./depositsUrl";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

const doneMessage = (code: string, detail: string): string | null => {
  switch (code) {
    case "matched":
      return detail ? `消し込みました（${detail}）。` : "消し込みました。";
    case "removed":
      return "外しました。";
    case "ignored":
      return "対象外にしました。";
    case "restored":
      return "未消込に戻しました。";
    case "import_cancelled":
      return `取り込みを取り消しました（${detail}件）。`;
    case "imported": {
      // ?detail=新規,候補あり
      const [added, suggested] = detail.split(",").map((n) => Number(n) || 0);
      return `登録しました（新規 ${formatQuantity(added)}件・候補あり ${formatQuantity(suggested)}件）。`;
    }
    default:
      return null;
  }
};

const ERROR_MESSAGES: Record<string, string> = {
  conflict: "ほかの人がこの入金を更新しました。画面を開き直してください。",
  status: "この入金は、すでに消込済み・対象外です。画面を開き直してください。",
  not_matched: "この入金は消込済みではありません。画面を開き直してください。",
  not_found: "入金または請求書が見つかりません。画面を開き直してください。",
  invoice_void: "この請求書は取り消されています。",
  invoice_taken: "この請求書は、ほかの入金で消し込まれています。",
  invoice_required: "請求書を選んでください。",
  amount: "金額が合わないため消し込めません。",
  date: "入金日が請求書の発行日より前のため、消し込めません。",
  ignore_reason: "対象外の理由を選んでください。",
  ignore_memo: `メモは${MAX_IGNORE_MEMO}文字以内で入力してください。`,
  import_matched: "消込済みの明細があるため取り消せません。先に消込を外してください。",
  import_not_found: "この取り込みは取り消せません（すでに取り消されています）。",
  failed: "保存できませんでした。時間をおいてもう一度お試しください。",
};

// 2件目以降の候補・G03 で選べない理由(CH-06)
const AMOUNT_REASON = "金額が合わないため、初回は消し込めません（まとめ払い・一部入金は今後の対応）";

// G01 入金消込(E-06 03 EV-01)と、G03 請求書を選んで消込(?select=入金のID。EV-05)
export default async function DepositsPage({ searchParams }: PageProps<"/admin/deposits">) {
  await requireAccess("receivables", DEPOSITS_URL);
  const params = await searchParams;
  const today = todayJST();

  // 手順1: ?tab=(なければ未消込)、?account=(なければ並び順の最初の対象口座)、?month=(【仮】なければ今月。E-06-仮-11)
  const accounts = (await listBankAccounts()).filter(isTargetAccount);
  const tabParam = str(params.tab);
  const tab: DepositsTab = isDepositsTab(tabParam) ? tabParam : "unmatched";
  const accountParam = str(params.account);
  const account: BankAccount | null = accounts.find((a) => a.id === accountParam) ?? accounts[0] ?? null;
  const monthParam = str(params.month);
  const month = isMonthStr(monthParam) ? monthParam : today.slice(0, 7);
  const base: DepositsQuery = { tab, account: account?.id, month: month === today.slice(0, 7) ? undefined : month };
  const back = { tab, account: account?.id ?? "", month };

  const done = doneMessage(str(params.done), str(params.detail));
  const errorCode = str(params.error);
  const selectId = str(params.select);
  const error = ERROR_MESSAGES[errorCode] ?? null;

  // 手順3・4
  const openInvoices = await listOpenInvoices();
  const invoiceById = new Map(openInvoices.map((i) => [i.id, i]));
  const counts = account ? await countDepositsByStatus(account.id, month) : { unmatched: 0, matched: 0, ignored: 0 };
  const deposits = account && tab !== "invoices" ? await listDeposits(account.id, month, tab) : [];
  const candidates = tab === "unmatched" ? candidatesForDeposits(deposits, openInvoices) : new Map();
  // 手順5
  const lastImport = account ? await getLastImport(account.id) : null;

  // G03(モーダル)。未消込でなければ G01 に戻す(EV-05 手順1)
  let selectDeposit: Deposit | null = null;
  if (selectId) {
    selectDeposit = isUuid(selectId) ? await getDeposit(selectId) : null;
    if (!selectDeposit || selectDeposit.matchStatus !== "unmatched") redirect(depositsUrl({ ...base, error: "status" }));
  }

  const monthLabel = (m: string) => formatYearMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const monthQuery = (m: string) => (m === today.slice(0, 7) ? undefined : m);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">入金消込</h1>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={ACCOUNTS_URL}>口座の設定</LinkButton>
          <LinkButton href={IMPORT_URL} variant="primary">
            明細を取り込む
          </LinkButton>
        </div>
      </div>
      {/* 手順2: 仮の形の表示(常に出す。閉じられない。要件整理 8.2) */}
      <Alert tone="info">
        この画面は仮の形です。銀行の明細と請求書の照らし合わせまでを行います。会計ソフト（エプソン 財務会計）への連携は今後の対応です。
      </Alert>
      {done && <Alert tone="success">{done}</Alert>}
      {error && !selectDeposit && <Alert tone="error">{error}</Alert>}

      <nav aria-label="表示する一覧" className="flex flex-wrap gap-2">
        {DEPOSITS_TABS.map((t) => {
          const active = t.key === tab;
          const n = t.key === "invoices" ? openInvoices.length : counts[t.key];
          return (
            <Link
              key={t.key}
              href={depositsUrl({ ...base, tab: t.key })}
              aria-current={active ? "page" : undefined}
              className={buttonClassName(active ? "primary" : "secondary")}
            >
              {t.label}
              {n > 0 && <Badge tone={t.key === "unmatched" ? "warning" : "neutral"}>{formatQuantity(n)}</Badge>}
            </Link>
          );
        })}
      </nav>

      {tab === "invoices" ? (
        <UnpaidInvoices invoices={openInvoices} today={today} />
      ) : !account ? (
        <EmptyState
          message="消込の対象の口座がありません。口座の設定で登録してください。"
          action={
            <LinkButton href={ACCOUNTS_URL} variant="primary">
              口座の設定
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <form method="get" className="flex items-end gap-2">
              {tab !== "unmatched" && <input type="hidden" name="tab" value={tab} />}
              {base.month && <input type="hidden" name="month" value={month} />}
              <Field id="account" label="口座">
                <AutoSubmitSelect id="account" name="account" defaultValue={account.id} className="w-72">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </option>
                  ))}
                </AutoSubmitSelect>
              </Field>
            </form>
            <div className="w-72">
              <PeriodNav
                label={`${monthLabel(month)}（入金日）`}
                prev={{ href: depositsUrl({ ...base, month: monthQuery(prevMonth) }), label: monthLabel(prevMonth) }}
                next={{ href: depositsUrl({ ...base, month: monthQuery(nextMonth) }), label: monthLabel(nextMonth) }}
              />
            </div>
          </div>

          {deposits.length === 0 ? (
            <EmptyState message="この口座・月の入金はありません。" />
          ) : tab === "unmatched" ? (
            <UnmatchedTable deposits={deposits} candidates={candidates} invoiceById={invoiceById} back={back} />
          ) : tab === "matched" ? (
            <MatchedTable deposits={deposits} back={back} />
          ) : (
            <IgnoredTable deposits={deposits} back={back} />
          )}

          {lastImport && (
            <form action={cancelImportAction} className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <input type="hidden" name="batch_id" value={lastImport.batchId} />
              <BackFields {...back} />
              <span>
                取り込み: {formatDateTime(lastImport.appliedAt)} {lastImport.byName ?? ""}（{account.bankName} {formatQuantity(lastImport.rowCount)}件）
              </span>
              <ConfirmSubmitButton
                variant="secondary"
                pendingText="取消中…"
                confirmMessage={`この取り込み（${lastImport.rowCount}件）を取り消してよいですか？取り込んだ明細が消えます。`}
              >
                取り込みを取り消す
              </ConfirmSubmitButton>
            </form>
          )}
        </>
      )}

      {selectDeposit && account && (
        <Modal title="請求書を選んで消込" closeHref={depositsUrl(base)}>
          <SelectInvoices
            deposit={selectDeposit}
            accountText={accountLabel(accounts.find((a) => a.id === selectDeposit.bankAccountId) ?? account)}
            customerParam={str(params.customer)}
            qParam={str(params.q)}
            base={base}
            back={back}
            error={error}
          />
        </Modal>
      )}
    </div>
  );
}

type Back = { tab: string; account: string; month: string };

const payerOf = (d: Deposit) => d.payerName ?? d.description ?? "−";

function UnmatchedTable({
  deposits,
  candidates,
  invoiceById,
  back,
}: {
  deposits: Deposit[];
  candidates: Map<string, { invoiceId: string; fee: number }[]>;
  invoiceById: Map<string, OpenInvoice>;
  back: Back;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas text-left">
          <tr>
            <th className="px-3 py-2">入金日</th>
            <th className="px-3 py-2">振込名義</th>
            <th className="px-3 py-2 text-right">入金額（円）</th>
            <th className="px-3 py-2">候補の請求書</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((d) => {
            const list = candidates.get(d.id) ?? [];
            const top = list[0];
            const inv = top ? invoiceById.get(top.invoiceId) : undefined;
            const selectHref = depositsUrl({ tab: "unmatched", account: back.account, month: back.month, select: d.id });
            return (
              <tr key={d.id} className="border-b border-line align-top last:border-b-0">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDateShort(d.transactionOn)}</td>
                <td className="px-3 py-2 break-words">{payerOf(d)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(d.deposit)}</td>
                <td className="px-3 py-2">
                  {top && inv ? (
                    <div className="flex flex-col gap-1">
                      <p>
                        <Link href={invoiceUrl(inv.id)} className="font-bold text-primary hover:underline tabular-nums">
                          {inv.invoiceNo}
                        </Link>{" "}
                        {inv.addressee}
                      </p>
                      <p className="tabular-nums">
                        {formatYen(inv.total, "included")}
                        {top.fee > 0 && <span className="ml-1">（差 {formatYen(top.fee)}＝手数料）</span>}
                      </p>
                      {list.length > 1 && <p className="text-xs text-ink-muted">ほかに候補 {list.length - 1}件</p>}
                    </div>
                  ) : (
                    <span className="text-ink-muted">候補なし</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {top && inv ? (
                      <>
                        {/* 確認のダイアログは出さず、そのまま確定する(外せるため。02 G01) */}
                        <form action={matchDepositAction}>
                          <input type="hidden" name="txn_id" value={d.id} />
                          <input type="hidden" name="invoice_id" value={inv.id} />
                          <input type="hidden" name="version" value={d.version} />
                          <BackFields {...back} />
                          <SubmitButton pendingText="消込中…">消込する</SubmitButton>
                        </form>
                        <LinkButton href={selectHref}>ほかを選ぶ</LinkButton>
                      </>
                    ) : (
                      <LinkButton href={selectHref}>請求書を選ぶ</LinkButton>
                    )}
                    <IgnoreButton
                      txnId={d.id}
                      label={`${formatDateShort(d.transactionOn)} ${payerOf(d)} ${formatYen(d.deposit)}`}
                      back={back}
                      action={ignoreDepositAction}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MatchedTable({ deposits, back }: { deposits: Deposit[]; back: Back }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas text-left">
          <tr>
            <th className="px-3 py-2">入金日</th>
            <th className="px-3 py-2">振込名義</th>
            <th className="px-3 py-2 text-right">入金額（円）</th>
            <th className="px-3 py-2">請求書</th>
            <th className="px-3 py-2 text-right">手数料（円）</th>
            <th className="px-3 py-2">消し込んだ人</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((d) => (
            <tr key={d.id} className="border-b border-line align-top last:border-b-0">
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDateShort(d.transactionOn)}</td>
              <td className="px-3 py-2 break-words">{payerOf(d)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(d.deposit)}</td>
              <td className="px-3 py-2">
                {d.invoiceId && (
                  <Link href={invoiceUrl(d.invoiceId)} className="font-bold text-primary hover:underline tabular-nums">
                    {d.invoiceNo}
                  </Link>
                )}{" "}
                {d.invoiceAddressee}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(d.feeAmount)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {d.matchedByName ?? "−"} {d.matchedAt ? formatDateShort(d.matchedAt) : ""}
              </td>
              <td className="px-3 py-2">
                <form action={removeMatchAction}>
                  <input type="hidden" name="txn_id" value={d.id} />
                  <input type="hidden" name="version" value={d.version} />
                  <BackFields {...back} />
                  <ConfirmSubmitButton
                    variant="secondary"
                    pendingText="外し中…"
                    confirmMessage="この消込を外してよいですか？請求書は未入金に戻ります。"
                  >
                    外す
                  </ConfirmSubmitButton>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IgnoredTable({ deposits, back }: { deposits: Deposit[]; back: Back }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-canvas text-left">
          <tr>
            <th className="px-3 py-2">入金日</th>
            <th className="px-3 py-2">振込名義</th>
            <th className="px-3 py-2 text-right">入金額（円）</th>
            <th className="px-3 py-2">理由</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((d) => (
            <tr key={d.id} className="border-b border-line align-top last:border-b-0">
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDateShort(d.transactionOn)}</td>
              <td className="px-3 py-2 break-words">{payerOf(d)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(d.deposit)}</td>
              <td className="px-3 py-2 break-words">{d.ignoreReason}</td>
              <td className="px-3 py-2">
                <form action={restoreDepositAction}>
                  <input type="hidden" name="txn_id" value={d.id} />
                  <BackFields {...back} />
                  <SubmitButton variant="secondary" pendingText="戻し中…">
                    未消込に戻す
                  </SubmitButton>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 未入金の請求書(EV-01 手順4)。期限の古い順。期限を過ぎたものは「期限切れ（○日）」
function UnpaidInvoices({ invoices, today }: { invoices: OpenInvoice[]; today: string }) {
  if (invoices.length === 0) return <EmptyState message="未入金の請求書はありません。" />;
  const total = invoices.reduce((sum, i) => sum + i.total, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left">
            <tr>
              <th className="px-3 py-2">番号</th>
              <th className="px-3 py-2">取引先</th>
              <th className="px-3 py-2 text-right">ご請求額（税込・円）</th>
              <th className="px-3 py-2">お支払期限</th>
              <th className="px-3 py-2">状態</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => {
              // 【仮】期限切れは「期限の日 < 今日」(E-05 の一覧と同じ。00_仮決め一覧 E-06-仮-12)
              const overdue = i.dueOn !== null && i.dueOn < today;
              return (
                <tr key={i.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    <Link href={invoiceUrl(i.id)} className="font-bold text-primary hover:underline">
                      {i.invoiceNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2 break-words">{i.addressee}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(i.total)}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{i.dueOn ? formatDateShort(i.dueOn) : "−"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {overdue && i.dueOn ? (
                      <Badge tone="danger">期限切れ（{daysBetween(i.dueOn, today)}日）</Badge>
                    ) : (
                      <Badge tone="warning">未入金</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm font-bold tabular-nums">
        合計 {formatQuantity(invoices.length)}件 {formatYen(total, "included")}
      </p>
    </div>
  );
}

// G03 請求書を選んで消込(EV-05): 発行済み・未入金・発行日 ≦ 入金日 の請求書。手数料の範囲外は選べない印を付ける
async function SelectInvoices({
  deposit,
  accountText,
  customerParam,
  qParam,
  base,
  back,
  error,
}: {
  deposit: Deposit;
  accountText: string;
  customerParam: string;
  qParam: string;
  base: DepositsQuery;
  back: Back;
  error: string | null;
}) {
  const customerId = isUuid(customerParam) ? customerParam : "";
  const q = qParam.slice(0, 50);
  const [customers, invoices] = [await listOpenInvoiceCustomers(), await listSelectableInvoices(deposit.transactionOn, { customerId, q })];
  const rows: SelectableInvoice[] = invoices.map((i) => {
    const check = checkMatch(deposit, i);
    return {
      id: i.id,
      invoiceNo: i.invoiceNo,
      addressee: i.addressee,
      total: i.total,
      dueLabel: i.dueOn ? formatDateShort(i.dueOn) : "−",
      diff: deposit.deposit - i.total,
      selectable: check.ok,
      reason: check.ok ? null : AMOUNT_REASON,
    };
  });
  // 選べる請求書を先に(その中は期限の古い順のまま)
  rows.sort((a, b) => Number(b.selectable) - Number(a.selectable));
  const defaultId =
    (deposit.suggestedInvoiceId && rows.find((r) => r.id === deposit.suggestedInvoiceId && r.selectable)?.id) ??
    rows.find((r) => r.selectable)?.id ??
    null;

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-sm tabular-nums">
        入金 {formatDateShort(deposit.transactionOn)} {payerOf(deposit)} <span className="font-bold">{formatYen(deposit.deposit)}</span>（{accountText}）
      </p>
      <form method="get" action={DEPOSITS_URL} className="flex flex-wrap items-end gap-2">
        {base.tab && base.tab !== "unmatched" && <input type="hidden" name="tab" value={base.tab} />}
        {base.account && <input type="hidden" name="account" value={base.account} />}
        {base.month && <input type="hidden" name="month" value={base.month} />}
        <input type="hidden" name="select" value={deposit.id} />
        <Field id="select_customer" label="取引先">
          <Select id="select_customer" name="customer" defaultValue={customerId} className="w-56">
            <option value="">すべて</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="select_q" label="番号・取引先名">
          <TextInput id="select_q" name="q" defaultValue={q} className="w-56" />
        </Field>
        <button type="submit" className={buttonClassName("secondary")}>
          検索する
        </button>
      </form>
      <p className="text-xs text-ink-muted">
        差が振込手数料の範囲（1〜{formatQuantity(FEE_MAX)}円）を超える請求書は選べません。{SELECT_INVOICES_LIMIT}件まで出します。
      </p>
      <SelectInvoiceForm
        txnId={deposit.id}
        version={deposit.version}
        invoices={rows}
        defaultInvoiceId={defaultId}
        back={back}
        closeHref={depositsUrl(base)}
        action={matchDepositAction}
      />
    </div>
  );
}
