import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { BANK_CSV_FORMATS, bankCsvFormatLabel } from "@/utils/bankCsv";
import { ACCOUNT_TYPES } from "@/utils/deposits";
import { getBankAccount, isUuid, listBankAccounts, type BankAccount } from "@/utils/depositsServer";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { BackLink, LinkButton } from "@/components/LinkButton";
import { Modal } from "@/components/Modal";
import { ACCOUNTS_URL, DEPOSITS_URL } from "../depositsUrl";
import { saveBankAccountAction } from "./actions";
import { AccountForm } from "./AccountForm";

const FORMAT_OPTIONS = Object.entries(BANK_CSV_FORMATS).map(([value, f]) => ({ value, label: f.label }));

const initialOf = (a: BankAccount | null): Record<string, string> =>
  a
    ? {
        bank_name: a.bankName,
        branch_name: a.branchName ?? "",
        account_type: a.accountType,
        account_number_last4: a.last4 ?? "",
        has_online_banking: a.hasOnlineBanking ? "1" : "",
        csv_format: a.csvFormat ?? "",
        is_target: a.isTarget ? "1" : "",
        sort_order: String(a.sortOrder),
        is_active: a.isActive ? "1" : "",
      }
    : // 新しい口座の初期値(01 6.1 の初期値と同じ)
      { account_type: "ordinary", is_target: "1", is_active: "1", sort_order: "0" };

// G04 銀行口座の設定(E-06 03 EV-10)。登録・編集はモーダル(?edit=new・?edit=口座のID)
export default async function BankAccountsPage({ searchParams }: PageProps<"/admin/deposits/accounts">) {
  await requireAccess("receivables", ACCOUNTS_URL);
  const params = await searchParams;
  const edit = typeof params.edit === "string" ? params.edit : "";
  const accounts = await listBankAccounts();
  const editing = edit && edit !== "new" && isUuid(edit) ? await getBankAccount(edit) : null;
  const showForm = edit === "new" || !!editing;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href={DEPOSITS_URL} label="入金消込へ" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">銀行口座</h1>
        <LinkButton href={`${ACCOUNTS_URL}?edit=new`} variant="primary">
          口座を登録する
        </LinkButton>
      </div>
      {params.saved === "1" && <Alert tone="success">保存しました。</Alert>}
      {edit && edit !== "new" && !editing && <Alert tone="error">この口座は見つかりません。</Alert>}

      {accounts.length === 0 ? (
        <EmptyState message="口座はまだ登録されていません。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">銀行</th>
                <th className="px-3 py-2">支店</th>
                <th className="px-3 py-2">種類</th>
                <th className="px-3 py-2">番号（下4けた）</th>
                <th className="px-3 py-2">ネットバンキング</th>
                <th className="px-3 py-2">CSVの形</th>
                <th className="px-3 py-2">消込の対象</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className={`border-b border-line last:border-b-0 ${a.isActive ? "" : "text-ink-muted"}`}>
                  <td className="px-3 py-2 break-words">
                    {a.bankName}
                    {!a.isActive && (
                      <span className="ml-2">
                        <Badge tone="neutral">使っていない</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{a.branchName ?? "−"}</td>
                  <td className="px-3 py-2">{ACCOUNT_TYPES[a.accountType]}</td>
                  <td className="px-3 py-2 tabular-nums">{a.last4 ?? "−"}</td>
                  <td className="px-3 py-2">{a.hasOnlineBanking ? "あり" : "なし"}</td>
                  <td className="px-3 py-2">{bankCsvFormatLabel(a.csvFormat) ?? "−（取り込めません）"}</td>
                  <td className="px-3 py-2">{a.isTarget ? "○" : "−"}</td>
                  <td className="px-3 py-2">
                    <Link href={`${ACCOUNTS_URL}?edit=${a.id}`} className="font-bold text-primary hover:underline">
                      編集
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-ink-muted">※口座番号は下4けただけを登録します。</p>

      {showForm && (
        <Modal title={editing ? `${editing.bankName}の編集` : "口座を登録する"} closeHref={ACCOUNTS_URL}>
          <AccountForm
            key={editing?.id ?? "new"}
            initial={initialOf(editing)}
            formatOptions={FORMAT_OPTIONS}
            closeHref={ACCOUNTS_URL}
            action={saveBankAccountAction.bind(null, editing?.id ?? null)}
          />
        </Modal>
      )}
    </div>
  );
}
