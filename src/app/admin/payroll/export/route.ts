// G01 「CSVを出力する」(E-03 EV-05)。締めたときの集計(snapshot)から月の集計のCSVを作って返す。
// GET にしないのは、リンクの先読み(プリフェッチ)で出力の回数が増えないようにするため(01 9章)。
// CSV には氏名と勤務時間(個人の情報)が入るので、サーバーに保存せずその場で作り、ブラウザに残さない(Cache-Control: private, no-store)。
// 権限は requireAccess("payroll") と同じ確認を行い、だめなら(ログイン画面へ移さずに)403 を返す。
import { canAccess, getCurrentEmployee } from "@/utils/auth";
import { toCsv } from "@/utils/csv";
import { isSameOrigin } from "@/utils/crossmall/importChecks";
import { getPayrollExport, recordPayrollExport } from "@/utils/payrollServer";
import { payrollCsvFileName, payrollCsvRows, snapshotHash, type PayrollSnapshot } from "@/utils/payrollSummary";
import { isValidDateStr } from "@/utils/textNormalize";

const text = (message: string, status: number) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  // 手順2 権限(ほかのサイトから送られたフォームも受けない)
  const me = await getCurrentEmployee();
  if (!me || me.mustChangePassword || !canAccess(me.roles, "payroll") || !isSameOrigin(request)) {
    return text("権限がありません。", 403);
  }

  const form = await request.formData().catch(() => null);
  const periodStart = String(form?.get("period_start") ?? "");
  if (!isValidDateStr(periodStart)) return text("対象の期間が正しくありません。", 400);

  // 手順3
  const row = await getPayrollExport(periodStart);
  if (row?.status !== "closed") return text("締めてから出力してください。", 409);
  // 手順4 CH-06
  if (snapshotHash(row.snapshot) !== row.snapshotHash) {
    return text("保存した集計が、締めたときの内容と一致しないため出力できません。", 409);
  }

  // 手順5 時間の表し方は今の定数(payrollRules.ts)を使う
  let body: string;
  try {
    body = toCsv(payrollCsvRows(row.snapshot as PayrollSnapshot));
  } catch (e) {
    console.error("給与CSVを作れませんでした:", e instanceof Error ? e.message : e);
    return text("CSVを作れませんでした。", 500);
  }

  // 手順6 出力の記録(保存できなくてもファイルは返す)
  try {
    await recordPayrollExport(periodStart, me.id);
  } catch (e) {
    console.error("給与CSVの出力の記録を保存できませんでした:", e instanceof Error ? e.message : e);
  }

  // 手順7 日本語のファイル名は RFC 5987 の形(filename*)で渡す
  const fileName = payrollCsvFileName(row.yearMonth);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
