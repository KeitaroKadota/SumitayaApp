// 定期実行(cron)の外枠(CMN-03 03 の 0.6、01 7.3、00_共通設計 7.1)。
// 入口は /api/cron/daily の1つだけ。毎朝7:00(日本時間)に、下の処理の表を上から順に1つずつ動かす。
// みるきーの src/app/api/cron/* の外枠(CRON_SECRET の確認・結果の記録・二重実行の防止)を参考にし、
// 二重実行の防止はシートの代わりに cron_runs の重複不可の制約で行う。
import { query } from "@/utils/db";
import { todayJST } from "@/utils/jst";
import { runTaskDigest, taskDigestRunsOn } from "@/utils/taskDigest";

export type DailyJob = {
  // 処理の名前(cron_runs.job_name。英小文字・数字・_)
  name: string;
  // 機能ID
  feature: string;
  // 動かす日か。false の日は動かさず skipped で残す。skipReason は summary に入れる理由
  runOn?: (today: string) => boolean | Promise<boolean>;
  skipReason?: string;
  // 処理の中身。戻り値は cron_runs.summary に入れる(件数など)
  run: (today: string) => Promise<Record<string, unknown>>;
};

export type JobResult = {
  name: string;
  // already: 今日はもう動いた(CH-15)
  result: "already" | "succeeded" | "failed" | "skipped";
  summary?: Record<string, unknown>;
  error?: string;
};

const ERROR_MAX = 500;

// 各機能の定期処理(まとめ通知より前に動かすもの)。足すときは 00_共通設計 7.1 と CMN-03 01 7.3 の表にも足す。
// 例: { name: "attendance_check", feature: "E-02", run: runAttendanceCheck }(E-02 を作るときに足す)
const JOBS_BEFORE_DIGEST: DailyJob[] = [];

// 最後は必ず毎朝のまとめ通知(その日のチェックで出たタスクもまとめに入れるため)
const TASK_DIGEST_JOB: DailyJob = {
  name: "task_digest",
  feature: "CMN-03",
  runOn: taskDigestRunsOn,
  skipReason: "closed_day",
  run: runTaskDigest,
};

export const DAILY_JOBS: readonly DailyJob[] = [...JOBS_BEFORE_DIGEST, TASK_DIGEST_JOB];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, ERROR_MAX);

// 1つの処理を動かす。例外は外に出さない(次の処理を止めないため)
export const runJob = async (job: DailyJob, today: string = todayJST()): Promise<JobResult> => {
  let runId: string;
  try {
    // 手順1 CH-15: 今日の行を作れなければ(もうある)動かさない
    const rows = await query(
      (sql) => sql<{ id: string }[]>`
        insert into cron_runs (job_name, run_on, status) values (${job.name}, ${today}, 'running')
        on conflict (job_name, run_on) do nothing
        returning id`
    );
    if (rows.length === 0) return { name: job.name, result: "already" };
    runId = rows[0].id;
  } catch (e) {
    // 記録を作れない(DBにつながらないなど)ときは動かさない
    console.error(`定期実行 ${job.name} を始められませんでした:`, errorText(e));
    return { name: job.name, result: "failed", error: errorText(e) };
  }

  const finish = async (status: "succeeded" | "failed" | "skipped", summary: Record<string, unknown> | null, error: string | null) => {
    try {
      await query(
        (sql) => sql`
          update cron_runs
          set status = ${status}, finished_at = now(), summary = ${summary ? JSON.stringify(summary) : null}::jsonb, error = ${error}
          where id = ${runId}`
      );
    } catch (e) {
      console.error(`定期実行 ${job.name} の記録を書けませんでした:`, errorText(e));
    }
  };

  try {
    // 手順3: 動かす日でなければ skipped
    if (job.runOn && !(await job.runOn(today))) {
      const summary = { reason: job.skipReason ?? "not_run_day" };
      await finish("skipped", summary, null);
      return { name: job.name, result: "skipped", summary };
    }
    // 手順4
    const summary = await job.run(today);
    await finish("succeeded", summary, null);
    return { name: job.name, result: "succeeded", summary };
  } catch (e) {
    // 手順5
    const error = errorText(e);
    console.error(`定期実行 ${job.name} が失敗しました:`, error);
    await finish("failed", null, error);
    return { name: job.name, result: "failed", error };
  }
};

// 処理の表を上から順に動かす(同時には動かさない。DB の接続1本の決まりのため)
export const runDailyJobs = async (): Promise<JobResult[]> => {
  const today = todayJST();
  const results: JobResult[] = [];
  for (const job of DAILY_JOBS) {
    results.push(await runJob(job, today));
  }
  return results;
};
