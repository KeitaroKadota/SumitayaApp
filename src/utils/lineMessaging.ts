// LINE Messaging API への送信(みるきーの lineMessaging.ts を流用。CMN-03 01 7.4)。
// 通知を送る公式アカウントのチャネルアクセストークン(長期)を環境変数 LINE_MESSAGING_CHANNEL_ACCESS_TOKEN に置く。
// 送ってよい相手かの確認・記録は notify.ts で行う。ここでは送るだけ。Webhook(reply)は使わないので持ってこない。
const LINE_API_BASE = "https://api.line.me/v2/bot/message";

export type LineTextMessage = { type: "text"; text: string };

const callLineApi = async (path: string, body: unknown) => {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_MESSAGING_CHANNEL_ACCESS_TOKEN が設定されていません");

  const response = await fetch(`${LINE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // 返事の本文にはトークンは含まれない(エラーの内容だけ)
    throw new Error(`LINE APIエラー(${path}): ${response.status} ${await response.text()}`);
  }
};

export const pushLineMessage = (to: string, messages: LineTextMessage[]) => callLineApi("/push", { to, messages });
