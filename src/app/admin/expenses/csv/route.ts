// G03 「CSVを出力する」(E-07 03 EV-18)。承認済みの、表示している月(支払った日)の経費を汎用の仕訳の形で返す。データは変えない。
// 氏名が入るのでブラウザに残さない(no-store)。権限は expenses_admin と同じ確認を行い、だめなら 403 を返す。
// みるきーの admin/import-export/csv/route.ts の作り(権限の確認、Content-Disposition)を流用した。
import { canAccess, getCurrentEmployee } from "@/utils/auth";
import { csvResponse } from "@/utils/csv";
import { buildExpenseCsvRows, type CsvExpense } from "@/utils/expenseClaims";
import { listApprovedForCsv } from "@/utils/expenseClaimsServer";
import { isMonthStr, monthRange } from "@/app/expenses/expensesView";

export async function GET(request: Request) {
  const me = await getCurrentEmployee();
  if (!me || me.mustChangePassword || !canAccess(me.roles, "expenses_admin"))
    return new Response("権限がありません。", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!isMonthStr(month)) return new Response("対象の月が正しくありません。", { status: 400 });
  const { from, to } = monthRange(month);
  const items: CsvExpense[] = (await listApprovedForCsv(from, to)).flatMap((e) =>
    e.spentOn && e.accountTitleName && e.payeeName
      ? [{
          spentOn: e.spentOn,
          titleName: e.accountTitleName,
          titleCode: e.accountTitleCode,
          total10: e.total10,
          tax10: e.tax10,
          total8: e.total8,
          tax8: e.tax8,
          totalExempt: e.totalExempt,
          payeeName: e.payeeName,
          purpose: e.purpose,
          applicantName: e.applicantName,
          registrationNo: e.registrationNo,
        }]
      : []
  );
  const res = csvResponse(`経費_${month}.csv`, buildExpenseCsvRows(items));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
