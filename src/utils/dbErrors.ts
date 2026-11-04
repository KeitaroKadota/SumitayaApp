// DBのエラーの見分け方。重複不可の制約(unique)に当たったとき、どの制約かで画面の文を変える。

type PgError = { code?: string; constraint_name?: string };

// 重複不可の制約に当たったか。constraint を渡すと、その名前の制約のときだけ true
export const isUniqueViolation = (e: unknown, constraint?: string): boolean => {
  if (typeof e !== "object" || e === null) return false;
  const err = e as PgError;
  if (err.code !== "23505") return false;
  return constraint === undefined || err.constraint_name === constraint;
};
