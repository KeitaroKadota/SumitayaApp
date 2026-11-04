// G07 アカウント欄の操作の結果の文(EV-08 手順7・EV-09 手順5)。
// 従業員の詳細画面(CMN-02)で ?done= を見て、画面の上に Alert(success / warning)で出す。

export type AccountActionState = { error: string | null };

export const ACCOUNT_DONE_MESSAGES: Record<string, { tone: "success" | "warning"; text: string }> = {
  password_emailed: { tone: "success", text: "初期パスワードをメールで送りました。" },
  password_shown: { tone: "success", text: "初期パスワードを画面に表示しました。本人に伝えてください。" },
  password_shown_mail_failed: {
    tone: "warning",
    text: "メールを送れなかったため、初期パスワードを画面に表示しました。本人に伝えてください。",
  },
  reset_link_sent: { tone: "success", text: "再設定リンクを送りました。" },
};
