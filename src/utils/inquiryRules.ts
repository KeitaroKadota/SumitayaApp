// 問い合わせ(D-01)の決まった値・表示名・チェック。DBを読まない計算だけのファイルなので、画面の部品からも使える。
// 設計書: D-01 01 4.1・4.2・6.1〜6.3、04 CH-01〜CH-04・CH-09〜CH-12

// 4.1 種類
export const INQUIRY_CATEGORIES = {
  stock: "在庫・納期の確認",
  return: "返品・交換の依頼",
  faq: "よくある質問",
  custom: "特注の相談",
  other: "その他",
} as const;
export type InquiryCategory = keyof typeof INQUIRY_CATEGORIES;
export const isInquiryCategory = (v: string): v is InquiryCategory => v in INQUIRY_CATEGORIES;
// 一覧の短い表示
export const INQUIRY_CATEGORY_SHORT: Record<InquiryCategory, string> = {
  stock: "在庫",
  return: "返品",
  faq: "FAQ",
  custom: "特注",
  other: "その他",
};

export const AI_CONFIDENCES = { high: "高", medium: "中", low: "低" } as const;
export type AiConfidence = keyof typeof AI_CONFIDENCES;

// 4.2 状態
export const INQUIRY_STATUSES = {
  new: "未対応",
  in_progress: "対応中",
  waiting: "お客様の返事待ち",
  replied: "返信済み",
  closed: "完了",
  ignored: "対応不要",
} as const;
export type InquiryStatus = keyof typeof INQUIRY_STATUSES;
export const isInquiryStatus = (v: string): v is InquiryStatus => v in INQUIRY_STATUSES;
// 一覧の初めの絞り込み(未対応・対応中・お客様の返事待ち)
export const OPEN_INQUIRY_STATUSES: InquiryStatus[] = ["new", "in_progress", "waiting"];

// CH-10 手で選べる状態の移り方(01 の 4.2 の図の矢印。replied・waiting へは「送信済みにする」を通してだけ移す)
const MANUAL_TRANSITIONS: Record<InquiryStatus, InquiryStatus[]> = {
  new: ["in_progress", "ignored"],
  in_progress: ["ignored"],
  waiting: ["in_progress", "ignored"],
  replied: ["closed", "in_progress", "ignored"],
  closed: ["in_progress"],
  ignored: ["in_progress"],
};
export const canChangeStatus = (from: InquiryStatus, to: InquiryStatus): boolean => MANUAL_TRANSITIONS[from].includes(to);
export const manualNextStatuses = (from: InquiryStatus): InquiryStatus[] => MANUAL_TRANSITIONS[from];

// 6.1 経路
export const INQUIRY_CHANNELS = {
  email: "メール",
  rakuten: "楽天",
  yahoo: "Yahoo!",
  amazon: "Amazon",
  futureshop: "自社ショップ",
  other: "その他",
} as const;
export type InquiryChannel = keyof typeof INQUIRY_CHANNELS;
export const isInquiryChannel = (v: string): v is InquiryChannel => v in INQUIRY_CHANNELS;

// 6.2 返信の案の種類・作り方・状態
export const REPLY_KINDS = {
  stock: "在庫の回答",
  faq: "よくある質問の回答",
  custom_ask: "特注の聞き返し",
  custom_estimate: "特注の概算",
  return: "返品の回答",
  free: "手で書いた返信",
} as const;
export type ReplyKind = keyof typeof REPLY_KINDS;
export const REPLY_DRAFT_SOURCES = { ai: "AI", template: "ひな形", manual: "手書き" } as const;
export type ReplyDraftSource = keyof typeof REPLY_DRAFT_SOURCES;
export type ReplyStatus = "draft" | "sent" | "discarded";

// CH-12 送った画面
export const SENT_VIA = {
  rakuraku: "楽楽自動応対",
  rakuten: "楽天",
  yahoo: "Yahoo!",
  amazon: "Amazon",
  futureshop: "自社ショップ",
  other: "その他",
} as const;
export type SentVia = keyof typeof SENT_VIA;
export const isSentVia = (v: string): v is SentVia => v in SENT_VIA;
// 初めの値は、問い合わせの経路に合わせる(メール → 楽楽自動応対)
export const defaultSentVia = (channel: InquiryChannel): SentVia => (channel === "email" ? "rakuraku" : channel);

// EV-12 送った後の状態
export const AFTER_SENT_STATUSES = ["replied", "waiting", "closed"] as const satisfies readonly InquiryStatus[];
export type AfterSentStatus = (typeof AFTER_SENT_STATUSES)[number];

// CH-04 長さの上限
export const INQUIRY_LIMITS = {
  body: 20000,
  subject: 300,
  customerName: 100,
  externalId: 100,
  email: 254,
  reply: 10000,
  memo: 2000,
  // AIに渡す本文の長さ【仮】(00_仮決め一覧 D-01-仮-06)
  aiBody: 8000,
  // 抜き出した情報の1項目【仮】(00_仮決め一覧 D-01-仮-12)
  extractedText: 200,
  extractedLongText: 1000,
  extractedProducts: 20,
  // 要約(04 CH-08)
  summary: 200,
} as const;

// 6.3 抜き出す情報
export const FAQ_TOPICS = {
  size: "サイズ",
  shipping: "送料",
  delivery: "納期",
  payment: "支払方法",
  care: "お手入れ",
  other: "その他",
} as const;
export type FaqTopic = keyof typeof FAQ_TOPICS;

export const RETURN_REASONS = {
  size: "サイズが合わない",
  defect: "不良品",
  wrong_item: "違う商品が届いた",
  damaged: "破損",
  changed_mind: "お客様の都合",
  other: "その他",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

export type ExtractedProduct = {
  name: string | null;
  code: string | null;
  size: string | null;
  color: string | null;
  quantity: number | null;
};

export const CUSTOM_SPEC_FIELDS = {
  item: "品目",
  fabric: "生地",
  size_and_quantity: "サイズと枚数",
  name_print: "名入れの内容",
  desired_delivery: "希望納期",
  budget: "予算",
  group_name: "団体名",
} as const;
export type CustomSpecField = keyof typeof CUSTOM_SPEC_FIELDS;
export type CustomSpec = Partial<Record<CustomSpecField, string | null>>;

export type InquiryExtracted = {
  customer_name?: string | null;
  order_number?: string | null;
  products?: ExtractedProduct[] | null;
  // 年-月-日
  desired_date?: string | null;
  faq_topics?: FaqTopic[] | null;
  custom_spec?: CustomSpec | null;
  return_reason?: ReturnReason | null;
  other_topics?: string | null;
};

// ---- CH-02 受信日時 ----

// 「YYYY/MM/DD HH:mm」(「年-月-日」も受け付ける)を日本時間として読む。読めなければ null
export const parseReceivedAt = (value: string): Date | null => {
  const m = value
    .normalize("NFKC")
    .trim()
    .match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T]+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
  // 日付の繰り上がり(2/30 など)を除く
  const jst = new Date(date.getTime() + 9 * 3600_000);
  if (jst.getUTCFullYear() !== y || jst.getUTCMonth() !== mo - 1 || jst.getUTCDate() !== d) return null;
  return date;
};

// 未来は5分のずれまで、過去は2年まで
export const RECEIVED_AT_FUTURE_TOLERANCE_MS = 5 * 60_000;
export const RECEIVED_AT_MAX_AGE_YEARS = 2;

// 受信日時の確かめ(CH-02)。だめなら理由の文を返す
export const checkReceivedAt = (date: Date | null, now: Date): string | null => {
  if (!date) return "受信日時は「2026/11/20 09:12」の形で入力してください。";
  if (date.getTime() > now.getTime() + RECEIVED_AT_FUTURE_TOLERANCE_MS) return "受信日時が今より先になっています。";
  const oldest = new Date(now);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - RECEIVED_AT_MAX_AGE_YEARS);
  if (date < oldest) return `受信日時が${RECEIVED_AT_MAX_AGE_YEARS}年より前になっています。入力を確かめてください。`;
  return null;
};

// 一覧の「経過」で、1時間を過ぎたら印を付ける(効果測定⑥の目標)
export const REPLY_TARGET_MINUTES = 60;
