// 入力フォームの結果の形(useActionState で画面に返す)。00_画面共通ルール 8章:
// 入力のエラーは欄の下とフォームの上に出し、入力した内容は消さない(values を defaultValue に戻す)。
// DBを読まないファイルなので、画面の部品(クライアント)からも使える。

export type FormState = {
  // 項目の name → エラーの文
  errors: Record<string, string>;
  // フォーム全体のエラー(システムのエラーなど)
  formError: string | null;
  // 送られた値(複数の値は「,」でつなぐ)
  values: Record<string, string>;
};

export const emptyFormState: FormState = { errors: {}, formError: null, values: {} };

// フォームの値をそのまま返せる形にする(ファイルは含めない)
export const formValues = (formData: FormData): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = formData.getAll(key).filter((v): v is string => typeof v === "string");
    values[key] = all.join(",");
  }
  return values;
};

// エラーの件数を入れたフォームの上の文(00_画面共通ルール 8章)
export const errorSummary = (errors: Record<string, string>): string =>
  `入力内容を確認してください（${Object.keys(errors).length}件）。`;
