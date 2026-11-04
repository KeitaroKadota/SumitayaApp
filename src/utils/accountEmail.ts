import { sendGmail } from "@/utils/gmail";

// アカウントのメール(CMN-01 03「メールの文面（案）」)。みるきーの staffAccountEmail.ts を流用し、文面をすみたや用にした。
// 【仮】文面は 00_仮決め一覧 CMN01-仮-12。

// メールに書くURLの起点(環境変数 SITE_URL。例: Vercel の本番URL)。末尾の「/」は取る
export const getSiteUrl = (): string => {
  const value = process.env.SITE_URL;
  if (!value) throw new Error("SITE_URL が設定されていません");
  return value.replace(/\/+$/, "");
};

export const sendInitialPasswordEmail = async ({
  to,
  lastName,
  loginId,
  password,
}: {
  to: string;
  lastName: string;
  loginId: string;
  password: string;
}) => {
  const siteUrl = getSiteUrl();
  await sendGmail({
    to,
    subject: "【祭すみたや 業務システム】初回ログインのご案内",
    text: [
      `${lastName}様`,
      "",
      "祭すみたや 業務システムのアカウントを作成しました。",
      "次の情報でログインし、画面の案内に従ってパスワードを変更してください。",
      "",
      `ログインURL: ${siteUrl}/login`,
      `ログインID: ${loginId}`,
      `初期パスワード: ${password}`,
      "",
      "このメールに心当たりがない場合は、中川社長へご連絡ください。",
    ].join("\n"),
  });
};

export const sendPasswordResetEmail = async ({ to, lastName, token }: { to: string; lastName: string; token: string }) => {
  const siteUrl = getSiteUrl();
  await sendGmail({
    to,
    subject: "【祭すみたや 業務システム】パスワード再設定のご案内",
    text: [
      `${lastName}様`,
      "",
      "パスワードの再設定の手続きを受け付けました。",
      "次のURLを開いて、新しいパスワードを設定してください。",
      "",
      `${siteUrl}/reset-password?token=${encodeURIComponent(token)}`,
      "",
      "このURLは発行から2時間だけ有効です。",
      "心当たりがない場合は、このメールを破棄し、中川社長へご連絡ください。",
    ].join("\n"),
  });
};
