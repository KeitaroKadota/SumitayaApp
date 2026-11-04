// D-02 在庫照会の答えの計算(03 の 0.1 calcStockAnswer・0.2 次の出荷する日、04 CH-02〜CH-07)。
// DBを読まない計算だけのファイル(DBを読む部分は stockAnswerData.ts)。AIは使わない。在庫数・日付はここで決める。
// 日付は日本時間の "YYYY-MM-DD" の文字列で受け渡す。画面の部品からも使える(DBの部品を読み込まない)。
import type { HolidayKind } from "@/utils/masterRules";
import {
  SHIPPING_CUTOFF_TIME,
  SHIPPING_SEARCH_DAYS,
  SHIP_ON_NATIONAL_HOLIDAY,
  SHIP_ON_REGULAR_CLOSED_DAY,
  STOCK_LIMITS,
  STOCK_REPLY_STALE_HOURS,
} from "@/utils/inquirySettings";

// ---- 判定(02 G01) ----

export const STOCK_JUDGEMENTS = {
  available: { mark: "○", label: "在庫あり" },
  incoming: { mark: "△", label: "発注済み" },
  estimate: { mark: "▲", label: "見込み（要確認）" },
  check: { mark: "？", label: "確認が必要" },
  discontinued: { mark: "×", label: "取り扱い終了" },
} as const;
export type StockJudgement = keyof typeof STOCK_JUDGEMENTS;
export const isStockJudgement = (v: string): v is StockJudgement => v in STOCK_JUDGEMENTS;

// ---- 日付(サーバーのタイムゾーンに左右されない) ----

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const jstParts = (at: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${get("hour")}:${get("minute")}` };
};

const addDays = (date: string, days: number): string => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

// 返信の文に入れる日付「11月21日（土）」(01 6.3 の {出荷日}・{入荷予定日})
export const formatReplyDate = (date: string): string => {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日（${WEEKDAYS[weekdayOf(date)]}）`;
};

// ---- 0.2 次の出荷する日 ----

export type CalendarEntry = { kind: HolidayKind; isClosed: boolean };

// 出荷する日か(holidays の行が無い日は出荷する日)。初回は祝日・臨時休業を出荷しない日とする(01 4.1)。
// 定休日(水・木)に出荷するかは未決(01 8章 #2)のため、inquirySettings.ts の定数で決める
export const shippingDayRule =
  (calendar: Map<string, CalendarEntry>) =>
  (date: string): boolean => {
    const c = calendar.get(date);
    if (!c) return true;
    if (c.kind === "national") return SHIP_ON_NATIONAL_HOLIDAY;
    if (!c.isClosed) return true;
    if (c.kind === "regular") return SHIP_ON_REGULAR_CLOSED_DAY;
    return false;
  };

// 起点の日から、出荷する日の最初の日(起点が今日なら締め時刻より前のときだけ今日)。最大30日先まで。無ければ null
export const nextShippingDay = (
  start: string,
  today: string,
  nowHHmm: string,
  isShippingDay: (date: string) => boolean
): string | null => {
  for (let i = 0; i <= SHIPPING_SEARCH_DAYS; i++) {
    const d = addDays(start, i);
    if (d < today || !isShippingDay(d)) continue;
    if (d === today && nowHHmm >= SHIPPING_CUTOFF_TIME) continue;
    return d;
  }
  return null;
};

// ---- 0.1 calcStockAnswer ----

export type StockProductInput = {
  productId: string;
  productCode: string;
  name: string;
  size: string | null;
  color: string | null;
  isActive: boolean;
  isInHouse: boolean;
  // 届くまでの日数(商品の値。空なら主な仕入先の値)。どちらも無ければ null
  leadTimeDays: number | null;
  quantityWanted: number;
  // B-01 の getStock。在庫の記録が無ければ null(CH-03)
  stock: { quantity: number; available: number | null; syncedAt: Date } | null;
  // A-03 の getIncomingByProduct の、その商品の分(発注残のある明細。入荷予定日の早い順)
  incoming: { openQty: number; expectedDate: string }[];
};

export type StockAnswerRow = {
  productId: string;
  productCode: string;
  // 商品名(サイズ・色を含む)
  displayName: string;
  quantityWanted: number;
  // 使う在庫数(引き当て可能な数。無ければ在庫数)。在庫の記録が無ければ null
  usableQuantity: number | null;
  judgement: StockJudgement;
  shipDate: string | null;
  // 入荷予定日(発注済み)・入荷見込日(未発注)
  incomingDate: string | null;
  // 「要確認」の印(確定の言い方をしない)
  needsConfirmation: boolean;
  notes: string[];
};

export type StockAnswer = {
  rows: StockAnswerRow[];
  // 在庫の時点(使った在庫の行のうち、いちばん古いもの。ISO 文字列)
  stockAsOf: string | null;
  // 在庫の時点から何時間たったか(表示用)
  stockAgeHours: number | null;
  stockStale: boolean;
  warnings: string[];
};

// 商品名にサイズ・色を足す(商品名に含まれていれば足さない)
export const displayNameOf = (p: { name: string; size: string | null; color: string | null }): string =>
  [p.name, ...[p.color, p.size].filter((v): v is string => !!v && !p.name.includes(v))].join(" ");

const calcRow = (
  p: StockProductInput,
  today: string,
  nowHHmm: string,
  isShippingDay: (date: string) => boolean
): StockAnswerRow => {
  const usable = p.stock ? (p.stock.available ?? p.stock.quantity) : null;
  const base = {
    productId: p.productId,
    productCode: p.productCode,
    displayName: displayNameOf(p),
    quantityWanted: p.quantityWanted,
    usableQuantity: usable,
    shipDate: null,
    incomingDate: null,
    needsConfirmation: false,
    notes: [] as string[],
  };
  // 手順1
  if (!p.isActive) return { ...base, judgement: "discontinued" };
  // CH-03 在庫の記録が無ければ、0 とみなさず「確認が必要」
  if (usable === null) return { ...base, judgement: "check", needsConfirmation: true, notes: ["在庫の記録がありません"] };
  // 手順2
  if (usable >= p.quantityWanted) {
    const ship = nextShippingDay(today, today, nowHHmm, isShippingDay);
    if (!ship)
      return { ...base, judgement: "check", needsConfirmation: true, notes: [`${SHIPPING_SEARCH_DAYS}日以内に出荷できる日がありません`] };
    return { ...base, judgement: "available", shipDate: ship };
  }
  // 手順3: 発注残のある入荷予定のうち、いちばん早いもの
  const incoming = p.incoming.filter((i) => i.openQty > 0).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0];
  if (incoming) {
    // CH-05 入荷予定日が過ぎている → 見込み(要確認)に下げ、日付は出さない
    if (incoming.expectedDate < today)
      return { ...base, judgement: "estimate", needsConfirmation: true, notes: ["入荷が遅れている可能性があります"] };
    return withShipDate({ ...base, judgement: "incoming", incomingDate: incoming.expectedDate }, today, nowHHmm, isShippingDay);
  }
  // 手順4: 未発注で、自社縫製でなく、届くまでの日数がある → 今日＋日数(要確認)
  if (!p.isInHouse && p.leadTimeDays !== null)
    return withShipDate(
      { ...base, judgement: "estimate", incomingDate: addDays(today, p.leadTimeDays), needsConfirmation: true },
      today,
      nowHHmm,
      isShippingDay
    );
  // 手順5
  return {
    ...base,
    judgement: "check",
    needsConfirmation: true,
    notes: [p.isInHouse ? "自社縫製の商品です" : "仕入先の届くまでの日数がありません"],
  };
};

// 手順6: 発注済み・見込みは、入荷予定日の翌日から数えた最初の出荷する日
const withShipDate = (
  row: StockAnswerRow,
  today: string,
  nowHHmm: string,
  isShippingDay: (date: string) => boolean
): StockAnswerRow => {
  const ship = row.incomingDate ? nextShippingDay(addDays(row.incomingDate, 1), today, nowHHmm, isShippingDay) : null;
  if (ship) return { ...row, shipDate: ship };
  return { ...row, judgement: "check", needsConfirmation: true, notes: [...row.notes, `入荷の後${SHIPPING_SEARCH_DAYS}日以内に出荷できる日がありません`] };
};

// 在庫の時点「11月20日 6時（14時間前）」
const ageHours = (at: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - at.getTime()) / 3_600_000));

const formatStockAsOf = (at: Date, now: Date): string => {
  const { date, hhmm } = jstParts(at);
  const [, m, d] = date.split("-").map(Number);
  const hours = ageHours(at, now);
  return `${m}月${d}日 ${Number(hhmm.slice(0, 2))}時（${hours}時間前）`;
};

export const isStockAsOfStale = (at: Date, now: Date): boolean =>
  now.getTime() - at.getTime() > STOCK_REPLY_STALE_HOURS * 3_600_000;

export const calcStockAnswer = (
  products: StockProductInput[],
  now: Date,
  isShippingDay: (date: string) => boolean
): StockAnswer => {
  const { date: today, hhmm } = jstParts(now);
  const rows = products.map((p) => calcRow(p, today, hhmm, isShippingDay));
  const warnings: string[] = [];

  // CH-04 在庫の時点(いちばん古いもの)
  const synced = products.flatMap((p) => (p.stock ? [p.stock.syncedAt] : []));
  const oldest = synced.length > 0 ? new Date(Math.min(...synced.map((d) => d.getTime()))) : null;
  const stale = oldest ? isStockAsOfStale(oldest, now) : false;
  if (oldest && stale)
    warnings.push(`在庫の時点: ${formatStockAsOf(oldest, now)}。最新のCSVを取り込んでから答えることをおすすめします。`);
  // CH-03・CH-05 などの商品ごとの注意
  for (const r of rows) for (const n of r.notes) warnings.push(`${r.displayName}: ${n}`);

  return {
    rows,
    stockAsOf: oldest ? oldest.toISOString() : null,
    stockAgeHours: oldest ? ageHours(oldest, now) : null,
    stockStale: stale,
    warnings,
  };
};

// ---- CH-02 欲しい数・CH-01 検索の言葉・CH-06 選んだ商品の数 ----

// 空なら1。1〜999の整数でなければ null
export const parseWantedQuantity = (value: string): number | null => {
  const s = value.normalize("NFKC").trim();
  if (!s) return 1;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= STOCK_LIMITS.quantityMax ? n : null;
};

export const checkStockSearchText = (value: string): string | null => {
  const s = value.trim();
  if (s.length < STOCK_LIMITS.searchMin) return "2文字以上入れてください。";
  if (s.length > STOCK_LIMITS.searchMax) return `探す言葉は${STOCK_LIMITS.searchMax}文字以内で入力してください。`;
  return null;
};

export const checkSelectedCount = (count: number): string | null =>
  count < 1
    ? "商品を1つ以上選んでください。"
    : count > STOCK_LIMITS.selectedMax
      ? `商品は${STOCK_LIMITS.selectedMax}件までにしてください。`
      : null;

// ---- ひな形の用途(01 6.2)と、差し込み欄の値(01 6.3) ----

export type StockPurpose = "stock_available" | "stock_incoming" | "stock_estimate" | "stock_check" | "stock_discontinued";

// 見込みでも日付が無いとき(入荷が遅れている)は「確認して連絡」のひな形にする【仮】(00_仮決め一覧 D-02-仮-13)
export const purposeOfRow = (r: StockAnswerRow): StockPurpose => {
  if (r.judgement === "available") return "stock_available";
  if (r.judgement === "incoming") return "stock_incoming";
  if (r.judgement === "estimate") return r.incomingDate ? "stock_estimate" : "stock_check";
  if (r.judgement === "discontinued") return "stock_discontinued";
  return "stock_check";
};

// 商品が複数で判定が違うときは、1つ目の商品の用途のひな形を使う【仮】(00_仮決め一覧 D-02-仮-12)
export const purposeOfAnswer = (rows: StockAnswerRow[]): StockPurpose => purposeOfRow(rows[0]);

const availabilityText = (r: StockAnswerRow): string | null => {
  if (r.judgement === "available") return "在庫がございます";
  // 在庫の記録が無い・取り扱い終了は、有無を書かない(CH-03)
  if (r.usableQuantity === null || r.judgement === "discontinued") return null;
  return "在庫を切らしております";
};

// {商品ごとの回答} の1行【仮】(00_仮決め一覧 D-02-仮-12)。在庫の数は書かない(D-02-仮-03)
export const rowAnswerLine = (r: StockAnswerRow): string => {
  const head = `・${r.displayName}: `;
  if (r.judgement === "available" && r.shipDate) return `${head}在庫がございます。${formatReplyDate(r.shipDate)}に出荷できます。`;
  if (r.judgement === "incoming" && r.incomingDate && r.shipDate)
    return `${head}在庫を切らしております。${formatReplyDate(r.incomingDate)}に入荷の予定で、${formatReplyDate(r.shipDate)}に出荷できる見込みです。`;
  if (r.judgement === "estimate" && r.incomingDate)
    return `${head}在庫を切らしております。${formatReplyDate(r.incomingDate)}ごろの入荷の見込みです。確定しましたら改めてご連絡します。`;
  if (r.judgement === "discontinued") return `${head}取り扱いを終了しております。`;
  return `${head}在庫と入荷の予定を確認して、改めてご連絡します。`;
};

// 差し込み欄の値。{商品名} などの1つの値の欄は、商品が1つのときだけ入れる(複数のときは {商品ごとの回答} を使う)
export const stockPlaceholderValues = (rows: StockAnswerRow[]): Record<string, string | null> => {
  const single = rows.length === 1 ? rows[0] : null;
  return {
    商品ごとの回答: rows.map(rowAnswerLine).join("\n"),
    商品名: single?.displayName ?? null,
    在庫の有無: single ? availabilityText(single) : null,
    在庫数: single?.usableQuantity != null ? String(single.usableQuantity) : null,
    出荷日: single?.shipDate ? formatReplyDate(single.shipDate) : null,
    入荷予定日: single?.incomingDate ? formatReplyDate(single.incomingDate) : null,
  };
};

// ---- 案の根拠(facts)の形 ----

export type StockFactsItem = {
  product_id: string;
  product_code: string;
  name: string;
  quantity_wanted: number;
  usable_quantity: number | null;
  judgement: StockJudgement;
  ship_date: string | null;
  incoming_date: string | null;
  needs_confirmation: boolean;
  notes: string[];
};

export const toFactsItems = (rows: StockAnswerRow[]): StockFactsItem[] =>
  rows.map((r) => ({
    product_id: r.productId,
    product_code: r.productCode,
    name: r.displayName,
    quantity_wanted: r.quantityWanted,
    usable_quantity: r.usableQuantity,
    judgement: r.judgement,
    ship_date: r.shipDate,
    incoming_date: r.incomingDate,
    needs_confirmation: r.needsConfirmation,
    notes: r.notes,
  }));

// facts の items を読み戻す(形が違うものは捨てる)
export const parseFactsItems = (v: unknown): StockFactsItem[] =>
  Array.isArray(v)
    ? v.filter(
        (x): x is StockFactsItem =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as StockFactsItem).product_id === "string" &&
          typeof (x as StockFactsItem).quantity_wanted === "number" &&
          typeof (x as StockFactsItem).judgement === "string" &&
          isStockJudgement((x as StockFactsItem).judgement)
      )
    : [];

// ---- CH-07 AIの文の数字・日付が計算と合う ----

const AI_MISMATCH = "AIの文に、計算と違う日付・数があります。確かめてください。";
const AI_YEN = "在庫の案に金額が入っています（在庫の案では金額を書かない決まりです）。確かめてください。";

// 「◯月◯日」「◯/◯」の月日を「月-日」で拾う(年月日「2026/11/21」の形も月日だけを見る)
export const extractMonthDays = (text: string): string[] => {
  const s = text.normalize("NFKC");
  const out: string[] = [];
  for (const m of s.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) out.push(`${Number(m[1])}-${Number(m[2])}`);
  for (const m of s.matchAll(/(?<![\d/])(?:\d{4}\/)?(\d{1,2})\/(\d{1,2})(?![\d/])/g)) out.push(`${Number(m[1])}-${Number(m[2])}`);
  return out;
};

// 「◯点」「◯個」「◯足」「◯枚」の数を拾う
export const extractCounts = (text: string): number[] =>
  [...text.normalize("NFKC").matchAll(/(\d[\d,]*)\s*(?:点|個|足|枚)/g)].map((m) => Number(m[1].replace(/,/g, "")));

export const checkAiStockText = (text: string, rows: StockAnswerRow[]): string[] => {
  const monthDay = (date: string) => {
    const [, m, d] = date.split("-").map(Number);
    return `${m}-${d}`;
  };
  const knownDates = new Set(rows.flatMap((r) => [r.shipDate, r.incomingDate].filter((d): d is string => !!d).map(monthDay)));
  const knownCounts = new Set(rows.flatMap((r) => [r.quantityWanted, ...(r.usableQuantity !== null ? [r.usableQuantity] : [])]));
  const warnings: string[] = [];
  const badDate = extractMonthDays(text).some((d) => !knownDates.has(d));
  const badCount = extractCounts(text).some((n) => !knownCounts.has(n));
  if (badDate || badCount) warnings.push(AI_MISMATCH);
  if (/\d[\d,]*\s*円/.test(text.normalize("NFKC"))) warnings.push(AI_YEN);
  return warnings;
};
