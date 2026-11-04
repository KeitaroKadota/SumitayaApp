// ログイン後の戻り先(/login?next=…)。みるきーの loginNext.ts をそのまま流用(CMN-01 01 7.1)。
// サーバー(ページ・Server Action)から使うため、"use client" を付けない。
// CH-09: 外のサイトへ飛ばされないよう、"/" で始まり "//" で始まらない、アプリ内のパスだけを許す(バックスラッシュ・改行なども許さない)。
export const safeNextPath = (value: string | null | undefined): string | null => {
  const v = (value ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.length > 500) return null;
  if (/[\\\s]/.test(v)) return null;
  return v;
};

// 未ログインのときに送るログイン画面のURL(戻り先付き)
export const loginUrlWithNext = (next: string): string => {
  const safe = safeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
};
