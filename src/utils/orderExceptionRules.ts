// 例外注文のルールのキーワード(B-02 04 の冒頭・CH-01)。DBを読まない計算だけのファイル。
// 【仮】キーワードはすべてヒアリング No.40 の回答で直す。
// B-02 はまだ作っていないので、今は B-01 の名入れ・加工の判定(B-01 04 CH-06 の2)で使う名入れのキーワードだけを置いた。
// B-02 を作るときに、ほかのルール(決済・同梱など)のキーワードと判定をこのファイルに足す。
import { katakanaToHiragana } from "@/utils/textNormalize";

// CH-01 名入れ・刺繍(name_print)のキーワード
export const NAME_PRINT_KEYWORDS = ["名入れ", "刺繍", "名前入れ", "文字入れ", "染め抜き"] as const;

// 直後に続いたら当てない言葉(「名入れなし」「刺繍不要」など。B-02 CH-01)
const NEGATIVE_SUFFIXES = ["なし", "無し", "不要"];

// 比べる前のそろえ方(B-02 04「文字の比べ方」): 全角英数字を半角に、カタカナをひらがなに、大文字を小文字に
export const normalizeForKeyword = (value: string): string => katakanaToHiragana(value).toLowerCase();

// 名入れ・刺繍のキーワードが含まれるか(「なし」「不要」が直後に続く場合は当てない)
export const hasNamePrintKeyword = (text: string): boolean => {
  const target = normalizeForKeyword(text);
  return NAME_PRINT_KEYWORDS.some((keyword) => {
    const k = normalizeForKeyword(keyword);
    let from = 0;
    for (;;) {
      const i = target.indexOf(k, from);
      if (i < 0) return false;
      const rest = target.slice(i + k.length).replace(/^[\s:：]+/, "");
      if (!NEGATIVE_SUFFIXES.some((n) => rest.startsWith(normalizeForKeyword(n)))) return true;
      from = i + k.length;
    }
  });
};
