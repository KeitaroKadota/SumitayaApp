import { requireAccess } from "@/utils/auth";
import { bankCsvFormatLabel } from "@/utils/bankCsv";
import { accountLabel } from "@/utils/deposits";
import { isImportableAccount, isTargetAccount, listBankAccounts } from "@/utils/depositsServer";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { DEPOSITS_URL, IMPORT_URL } from "../depositsUrl";
import { cancelBankPreview } from "./actions";
import { DepositImportForm } from "./DepositImportForm";

// G02 明細の取り込み(E-06 03 EV-02・EV-03。A-01 の「確認→登録」の2段階)
export default async function DepositImportPage({ searchParams }: PageProps<"/admin/deposits/import">) {
  await requireAccess("receivables", IMPORT_URL);
  const params = await searchParams;
  const accountParam = typeof params.account === "string" ? params.account : "";

  // 消込の対象の口座を出す。CSVの形が設定されていない口座は選べない(CH-02)
  const accounts = (await listBankAccounts()).filter(isTargetAccount).map((a) => ({
    id: a.id,
    label: accountLabel(a),
    formatLabel: bankCsvFormatLabel(a.csvFormat),
    importable: isImportableAccount(a),
  }));
  const first = accounts.find((a) => a.id === accountParam && a.importable) ?? accounts.find((a) => a.importable);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href={DEPOSITS_URL} label="入金消込へ" />
      </div>
      <h1 className="text-2xl font-bold">銀行の明細を取り込む</h1>
      {!first && <Alert tone="warning">取り込める口座がありません。口座の設定で「CSVの形」を選んでください。</Alert>}
      <DepositImportForm
        uploadUrl={`${IMPORT_URL}/upload`}
        accounts={accounts}
        defaultAccountId={first?.id ?? ""}
        cancelAction={cancelBankPreview}
      />
    </div>
  );
}
