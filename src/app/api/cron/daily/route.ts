// EV-16 毎朝の cron の入口(CMN-03 03、00_共通設計 7.1)。定期実行の入口はこれ1つだけ。
// Vercel Cron が毎朝7:00(日本時間。vercel.json の "0 22 * * *")に GET で呼ぶ。
// Route Handler の GET は既定で結果を保存(キャッシュ)しない。リクエストのヘッダーを読むので毎回動く。
import { NextResponse, type NextRequest } from "next/server";
import { runDailyJobs } from "@/utils/cron";

export async function GET(request: NextRequest) {
  // CH-14: Authorization が Bearer {CRON_SECRET} と同じであること。CRON_SECRET が無いときはだれからの呼び出しも 401
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 手順2・3: 1つが失敗しても次に進む。失敗があっても 200 を返す(再実行させず、翌朝にやり直す)
  const results = await runDailyJobs();
  return NextResponse.json({ results });
}
