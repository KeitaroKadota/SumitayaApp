// 業務日付・時刻は Asia/Tokyo に統一する(みるきーの jst.ts をそのまま流用。CMN-02 01 7.1)。

// 今日の日付をJSTのYYYY-MM-DD形式で返す
export const todayJST = (): string => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// 現在時刻をISO文字列で返す(サーバー時刻をそのまま実績として使う)
export const nowISO = (): string => new Date().toISOString();

// ISO文字列をJSTのHH:mm表示に変換する
export const formatTimeJST = (iso: string): string =>
  new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

// ISO文字列をJSTのM月D日 HH:mm表示に変換する
export const formatDateTimeJST = (iso: string): string =>
  new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// HH:mm形式かどうかを検証する
export const isValidHHmm = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

// "YYYY-MM-DD"の曜日(0=日〜6=土)を返す。
// `new Date(`${date}T00:00:00+09:00`).getDay()`のように、タイムゾーン付き文字列をパースして
// getDay()で読み戻す方式は、サーバーのローカルタイムゾーンがJSTでない場合(Vercelの既定はUTC)、
// 日付が前日にズレて曜日を1つ古く返す。Date.UTCで組み立てgetUTCDayで読むことで、
// サーバーのTZ設定に依存せず常に正しい曜日を返す。
export const weekdayOfDateStr = (dateStr: string): number => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

// 利用日(YYYY-MM-DD)とHH:mmから、JSTでのその時刻を表すDateを作る
export const combineDateTimeJST = (dateStr: string, hhmm: string): Date => new Date(`${dateStr}T${hhmm}:00+09:00`);
