// Gmail API でメールを送る(みるきーの gmail.ts を流用。CMN-01 01 5章)。
// 送信元は当面、角田さんの Gmail(2026-11-03 決定。本番の前に見直す可能性あり)。
// アドレスはリポジトリに残さないよう環境変数 MAIL_FROM_ADDRESS に置く。
// 送信元を変えるときは、MAIL_FROM_ADDRESS と GOOGLE_OAUTH_*(そのアカウントで発行したもの)を一緒に変える。
// 【仮】差出人の表示名(00_仮決め一覧 CMN01-仮-15)
const FROM_NAME = "祭すみたや 業務システム";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`メール送信の設定(${name})がありません`);
  return value;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

const getAccessToken = async (): Promise<string> => {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!json.access_token) {
    // 応答の中身(トークンなど)はログに出さず、エラーの種類だけを書く
    throw new Error(`Googleアクセストークンの取得に失敗しました: ${res.status} ${json.error ?? ""}`);
  }

  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cachedToken.token;
};

const encodeBase64Url = (input: string): string =>
  Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ヘッダーに日本語が含まれる場合の文字化け防止(MIMEエンコード、RFC 2047)
const encodeHeaderWord = (value: string) => `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;

export const sendGmail = async ({ to, subject, text }: { to: string; subject: string; text: string }) => {
  // 宛先に改行などが入ると、ほかのヘッダーを差し込まれるため弾く
  if (/[\r\n]/.test(to) || !/^[^\s@]+@[^\s@]+$/.test(to)) throw new Error("メールアドレスの形が正しくありません");

  const fromAddress = requireEnv("MAIL_FROM_ADDRESS");
  const token = await getAccessToken();

  const raw = [
    `From: ${encodeHeaderWord(FROM_NAME)} <${fromAddress}>`,
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    text,
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeBase64Url(raw) }),
  });

  if (!res.ok) {
    throw new Error(`Gmail送信に失敗しました: ${res.status}`);
  }
};
