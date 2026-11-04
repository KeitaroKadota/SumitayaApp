// AI(Gemini)を呼ぶ共通の仕組み(D-01 01 7.3、03 0.1・0.3、04 CH-06〜CH-08・CH-13、00_共通設計 4章・7.4)。
// AIを使うすべての機能(D-01〜D-04・D-06・C-01・E-04・E-07)はここを通して呼ぶ。直接 Gemini を呼ばない。
// - 呼ぶ前に ai_requests に1行入れて数える。1日の回数は全機能で共有して数える。
// - AIに渡した文・返ってきた文は記録に残さない(結果は各機能のテーブルに残す)。
// - 失敗しても例外を投げず、「使えない(理由つき)」を返す(画面は手入力・ひな形に切り替える)。
// - 自動のやり直しはしない(回数を使ってしまうため)。
// Gemini API(REST)を fetch で呼ぶ(ライブラリは入れない。00_仮決め一覧 D-01-仮-09)。
import { query } from "@/utils/db";
import { toGeminiSchema, validateAiJson, type AiSchema } from "@/utils/aiSchema";
import { AI_COMMON_PREAMBLE } from "@/utils/prompts/common";

// 【仮】使うモデル。環境変数 GEMINI_MODEL が空ならこれを使う(D-01 01 8章、00_仮決め一覧 D-01-仮-09)。
// 無料版でも使える安定版の軽いモデル(Google の料金の資料で「Free of charge」、モデルの資料で Stable。2026-11-04 確認)。
// 有料のキーに切り替えるときも、モデルを変えるなら環境変数で変える(コードは直さない)
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// 【仮】1日の回数(00_共通設計 7.4、00_仮決め一覧 D-01-仮-04)。環境変数が無いときの初期値
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_STOP_AT = 18;
const DEFAULT_WARN_AT = 15;
// 【仮】1日の区切り: Gemini の無料版の回数が戻る時刻(太平洋時間の0時)
export const AI_QUOTA_TIME_ZONE = "America/Los_Angeles";

// 待ち時間(既定30秒、最大55秒。操作の最大時間60秒の中に収める)
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 55_000;
// started のまま5分たった行は timeout とみなす(数えるのは同じ)
// 【仮】CH-13 送れるファイル(00_仮決め一覧 D-01-仮-08)
const ALLOWED_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
const MAX_FILES = 10;
const MAX_TOTAL_FILE_BYTES = 18 * 1024 * 1024;

// 目的(purpose)の表(D-01 01 7.3)。機能が増えるたびにここに足す(DB の CHECK にはしない)
export const AI_PURPOSES = {
  classify: { featureId: "D-01", label: "問い合わせの種類の見分け・情報の抜き出し" },
  draft_reply: { featureId: "D-02〜D-04・D-06", label: "返信文の案" },
  delivery_slip_ocr: { featureId: "C-01", label: "納品書の読み取り" },
  received_invoice_read: { featureId: "E-04", label: "受け取った請求書の読み取り" },
  expense_receipt_read: { featureId: "E-07", label: "領収書の読み取りと勘定科目の案" },
} as const;
export type AiPurpose = keyof typeof AI_PURPOSES;

export type AiFile = { bytes: Uint8Array; mimeType: string };

export type AiUnavailableReason = "disabled" | "quota" | "error" | "invalid" | "timeout";

// 「使えない」の細かい理由(画面の文を分けるため。設定の間違いは、門田さんが環境変数を直せば戻る)
export type AiFailureDetail = "no_key" | "bad_key" | "bad_model" | "limit" | null;

export type AiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; reason: AiUnavailableReason; detail: AiFailureDetail; message: string };

// 画面に出す「使えない」ときの文(00_画面共通ルール 7章、D-01 01 7.4)。どれも手での対応に切り替えられることを書く
export const AI_UNAVAILABLE_MESSAGES: Record<AiUnavailableReason, string> = {
  disabled: "AIの設定（APIキー）がありません。種類は手で選び、返信はひな形から作ってください。",
  quota: "本日のAIの利用回数に達しました。種類は手で選び、返信はひな形から作ってください。",
  error: "AIで作れませんでした。手で選んでください。",
  invalid: "AIで作れませんでした。手で選んでください。",
  timeout: "AIで作れませんでした（時間がかかりすぎました）。手で選んでください。",
};
const DETAIL_MESSAGES: Record<Exclude<AiFailureDetail, null>, string> = {
  no_key: AI_UNAVAILABLE_MESSAGES.disabled,
  bad_key: "AIのAPIキーが正しくないため、AIを使えませんでした。種類は手で選んでください。（管理者の方: 環境変数 GEMINI_API_KEY を確かめてください）",
  bad_model: "AIのモデル名が見つからないため、AIを使えませんでした。種類は手で選んでください。（管理者の方: 環境変数 GEMINI_MODEL を確かめてください）",
  limit: AI_UNAVAILABLE_MESSAGES.quota,
};

const readIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

const aiConfig = () => ({
  apiKey: process.env.GEMINI_API_KEY ?? "",
  model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  dailyLimit: readIntEnv("AI_DAILY_LIMIT", DEFAULT_DAILY_LIMIT),
  stopAt: readIntEnv("AI_STOP_AT", DEFAULT_STOP_AT),
  warnAt: readIntEnv("AI_WARN_AT", DEFAULT_WARN_AT),
});

// ---- CH-07 AIに渡す前にメールアドレス・電話番号を伏せる ----

const EMAIL_PATTERN = /[^\s@<>()[\]"'、。，,;:：；（）「」]+@[^\s@<>()[\]"'、。，,;:：；（）「」]+\.[^\s@<>()[\]"'、。，,;:：；（）「」]+/g;
// 0から始まる10〜11けたの数字(ハイフン・空白・かっこ・全角数字を含む)。
// 前が数字・ハイフンのとき(注文番号の一部)は伏せない(注文番号は D-06 で使うため伏せない)
const PHONE_PATTERN = /(?<![0-9０-９\-‐－−])[(（]?[0０](?:[ 　\-‐－−()（）]{0,2}[0-9０-９]){9,10}(?![0-9０-９])/g;

export const maskPersonalInfo = (text: string): string =>
  text.replace(EMAIL_PATTERN, "[メール]").replace(PHONE_PATTERN, "[電話]");

// ---- CH-06 回数の上限 ----

// 回数に数える行(Google 側で数えられた可能性があるもの)。quota は数えず「停止中」の印に使う
const COUNTED_STATUSES = ["started", "success", "error", "invalid", "timeout"];

export type AiUsageState = "available" | "low" | "stopped";

export type AiUsage = {
  // 今日(直前の太平洋時間0時から)使った回数
  used: number;
  // 止める回数までの残り(0未満は0)
  remaining: number;
  dailyLimit: number;
  state: AiUsageState;
  // stopped の理由(no_key: APIキーが無い / limit: 止める回数に達した / quota_error: Google の上限エラー / db_error: 数えられない)
  stoppedReason: "no_key" | "limit" | "quota_error" | "db_error" | null;
  // 次に回数が戻る時刻(ISO文字列。表示は日本時間)
  resetsAt: string | null;
};

// 直前の太平洋時間0時から後の、数える行の件数・上限エラーの有無・次に戻る時刻を DB で求める(夏時間も DB が扱う)
const readUsage = async () => {
  const [row] = await query(
    (sql) => sql<{ used: number; has_quota_error: boolean; resets_at: Date }[]>`
      with w as (
        select (date_trunc('day', now() at time zone ${AI_QUOTA_TIME_ZONE}) at time zone ${AI_QUOTA_TIME_ZONE}) as from_at,
               ((date_trunc('day', now() at time zone ${AI_QUOTA_TIME_ZONE}) + interval '1 day') at time zone ${AI_QUOTA_TIME_ZONE}) as resets_at
      )
      select
        (select count(*)::int from ai_requests, w
          where created_at >= w.from_at and status in ${sql(COUNTED_STATUSES)}) as used,
        exists (select 1 from ai_requests, w where created_at >= w.from_at and status = 'quota') as has_quota_error,
        (select resets_at from w) as resets_at`
  );
  return { used: row.used, hasQuotaError: row.has_quota_error, resetsAt: row.resets_at };
};

// 0.3 残りの回数(G05 の表示。C-01・E-04・E-07 も同じ値を使う)
export const getAiUsage = async (): Promise<AiUsage> => {
  const config = aiConfig();
  let usage: Awaited<ReturnType<typeof readUsage>>;
  try {
    usage = await readUsage();
  } catch (e) {
    console.error("AIの回数を数えられませんでした:", e instanceof Error ? e.message : e);
    return {
      used: 0,
      remaining: 0,
      dailyLimit: config.dailyLimit,
      state: "stopped",
      stoppedReason: "db_error",
      resetsAt: null,
    };
  }
  const remaining = Math.max(0, config.stopAt - usage.used);
  const stoppedReason = !config.apiKey
    ? "no_key"
    : usage.hasQuotaError
      ? "quota_error"
      : usage.used >= config.stopAt
        ? "limit"
        : null;
  const state: AiUsageState = stoppedReason ? "stopped" : usage.used >= config.warnAt ? "low" : "available";
  return {
    used: usage.used,
    remaining,
    dailyLimit: config.dailyLimit,
    state,
    stoppedReason,
    resetsAt: usage.resetsAt.toISOString(),
  };
};

// ---- CH-13 AIに送るファイル ----

const checkFiles = (files: AiFile[]): string | null => {
  if (files.length > MAX_FILES) return `ファイルは${MAX_FILES}個までです`;
  if (files.some((f) => !(ALLOWED_FILE_TYPES as readonly string[]).includes(f.mimeType))) return "送れない種類のファイルです";
  const total = files.reduce((sum, f) => sum + f.bytes.byteLength, 0);
  if (total > MAX_TOTAL_FILE_BYTES) return "ファイルが大きすぎます";
  if (files.some((f) => f.bytes.byteLength === 0)) return "空のファイルがあります";
  return null;
};

// ---- 0.1 callGeminiJson ----

export type CallGeminiJsonParams = {
  featureId: string;
  purpose: AiPurpose;
  targetTable?: string | null;
  targetId?: string | null;
  // 機能ごとの指示(共通の前置きはここで頭に付ける)
  instruction: string;
  // 入力の文(メールアドレス・電話番号はここで伏せる)
  input: string;
  files?: AiFile[];
  // 答えの形
  schema: AiSchema;
  // 押した人(定期実行などから呼ぶときは null)
  requestedBy: string | null;
  timeoutMs?: number;
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; status?: string; details?: { reason?: string }[] };
};

// Google のエラーから、設定の間違い(キー・モデル名)を見分ける
const errorDetailOf = (httpStatus: number, errorCode: string): AiFailureDetail => {
  if (httpStatus === 401 || httpStatus === 403 || /API_KEY_INVALID|API_KEY|UNAUTHENTICATED|PERMISSION_DENIED/.test(errorCode))
    return "bad_key";
  if (httpStatus === 404 || /NOT_FOUND/.test(errorCode)) return "bad_model";
  return null;
};

// 手順3: 呼び出し中の行を入れ、入れた後に数え直す(同時に押されても数え漏れないように。CH-06)。
// 自分より前の数える行が止める回数以上なら、行を消して呼ばない。
const reserveRequest = async (
  params: CallGeminiJsonParams,
  model: string,
  stopAt: number
): Promise<{ ok: true; id: string } | { ok: false }> => {
  const [row] = await query(
    (sql) => sql<{ id: string; created_at: Date }[]>`
      insert into ai_requests (feature_id, purpose, target_table, target_id, file_count, model, status, requested_by)
      values (${params.featureId}, ${params.purpose}, ${params.targetTable ?? null}, ${params.targetId ?? null},
              ${params.files?.length ?? 0}, ${model}, 'started', ${params.requestedBy})
      returning id, created_at`
  );
  const [count] = await query(
    (sql) => sql<{ before: number; has_quota_error: boolean }[]>`
      with w as (
        select (date_trunc('day', now() at time zone ${AI_QUOTA_TIME_ZONE}) at time zone ${AI_QUOTA_TIME_ZONE}) as from_at
      )
      select
        (select count(*)::int from ai_requests, w
          where created_at >= w.from_at and status in ${sql(COUNTED_STATUSES)}
            and (created_at < ${row.created_at} or (created_at = ${row.created_at} and id < ${row.id}))) as before,
        exists (select 1 from ai_requests, w where created_at >= w.from_at and status = 'quota') as has_quota_error`
  );
  if (count.before >= stopAt || count.has_quota_error) {
    await query((sql) => sql`delete from ai_requests where id = ${row.id}`);
    return { ok: false };
  }
  return { ok: true, id: row.id };
};

// 手順7: 結果で記録を更新する(失敗しても結果は呼んだ機能へ返す)
const finishRequest = async (
  id: string,
  status: "success" | "error" | "invalid" | "quota" | "timeout",
  detail: { errorMessage?: string; promptTokens?: number; outputTokens?: number; durationMs: number }
) => {
  try {
    await query(
      (sql) => sql`
        update ai_requests set
          status = ${status},
          error_message = ${detail.errorMessage ? detail.errorMessage.slice(0, 500) : null},
          prompt_tokens = ${detail.promptTokens ?? null},
          output_tokens = ${detail.outputTokens ?? null},
          duration_ms = ${detail.durationMs}
        where id = ${id}`
    );
  } catch (e) {
    console.error("AIの呼び出しの記録を更新できませんでした:", e instanceof Error ? e.message : e);
  }
};

export const callGeminiJson = async <T>(params: CallGeminiJsonParams): Promise<AiResult<T>> => {
  const config = aiConfig();
  const fail = (reason: AiUnavailableReason, detail: AiFailureDetail = null): AiResult<T> => ({
    ok: false,
    reason,
    detail,
    message: detail ? DETAIL_MESSAGES[detail] : AI_UNAVAILABLE_MESSAGES[reason],
  });

  // 手順1: APIキーが無ければ停止中
  if (!config.apiKey) return fail("disabled", "no_key");

  // 手順2: CH-06 回数の上限
  const usage = await getAiUsage();
  if (usage.state === "stopped") return usage.stoppedReason === "db_error" ? fail("error") : fail("quota", "limit");

  // 手順2B: CH-13 ファイル(だめなら記録を作らない＝回数に数えない)
  const files = params.files ?? [];
  if (files.length > 0 && checkFiles(files)) return fail("invalid");

  // 手順3: 呼び出し中の行を入れる
  let requestId: string;
  try {
    const reserved = await reserveRequest(params, config.model, config.stopAt);
    if (!reserved.ok) return fail("quota", "limit");
    requestId = reserved.id;
  } catch (e) {
    console.error("AIの呼び出しを記録できませんでした:", e instanceof Error ? e.message : e);
    return fail("error");
  }

  // 手順4・5: 伏せた入力の文と、ファイル(ページ順)を、答えの形の指定と一緒に送る
  const timeoutMs = Math.min(Math.max(params.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
  const body = {
    systemInstruction: { parts: [{ text: `${AI_COMMON_PREAMBLE}\n\n${params.instruction}` }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: maskPersonalInfo(params.input) },
          ...files.map((f) => ({
            inlineData: { mimeType: f.mimeType, data: Buffer.from(f.bytes).toString("base64") },
          })),
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: toGeminiSchema(params.schema),
    },
  };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = controller.signal.aborted;
    await finishRequest(requestId, aborted ? "timeout" : "error", {
      errorMessage: aborted ? "待ち時間を過ぎた" : `通信に失敗した: ${e instanceof Error ? e.name : "unknown"}`,
      durationMs: Date.now() - started,
    });
    return fail(aborted ? "timeout" : "error");
  }

  let json: GeminiResponse | null = null;
  try {
    json = (await res.json()) as GeminiResponse;
  } catch {
    json = null;
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - started;
  const tokens = {
    promptTokens: json?.usageMetadata?.promptTokenCount,
    outputTokens: json?.usageMetadata?.candidatesTokenCount,
  };

  // 429: Google の上限エラー。次に回数が戻るまで止める(getAiUsage が quota の行を見る)
  if (res.status === 429) {
    await finishRequest(requestId, "quota", { errorMessage: "HTTP 429", durationMs, ...tokens });
    return fail("quota", "limit");
  }
  if (!res.ok || !json) {
    const status = controller.signal.aborted ? "timeout" : "error";
    // 記録には Google のエラーの種類だけを残す(説明の文は残さない)
    const errorCode = [json?.error?.status, ...(json?.error?.details ?? []).map((d) => d.reason)].filter(Boolean).join(" ");
    await finishRequest(requestId, status, {
      errorMessage: `HTTP ${res.status}${errorCode ? ` ${errorCode}` : ""}`,
      durationMs,
      ...tokens,
    });
    return fail(status, status === "timeout" ? null : errorDetailOf(res.status, errorCode));
  }

  // 手順6: CH-08 答えの形
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const reason = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason ?? "JSONとして読めない";
    await finishRequest(requestId, "invalid", { errorMessage: `答えの形がおかしい: ${reason}`, durationMs, ...tokens });
    return fail("invalid");
  }
  const checked = validateAiJson(params.schema, parsed);
  if (!checked.ok) {
    await finishRequest(requestId, "invalid", { errorMessage: "答えの形がおかしい: 必須の項目が無い", durationMs, ...tokens });
    return fail("invalid");
  }

  // 手順7・8
  await finishRequest(requestId, "success", { durationMs, ...tokens });
  return { ok: true, data: checked.value as T, requestId };
};
