// LINE ログイン(みるきーの line.ts を流用。CMN-03 01 4.2・7.4)。
// すみたやでは LINE でログインはしない。通知の宛先(本人の LINE の ID)を取るためだけに使う(2026-11-03 門田さん承認)。
// チャネルは、通知を送る公式アカウント(Messaging API)と同じプロバイダーに作ること(違うと ID が別になり通知が届かない)。
const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`LINE ログインの設定(${name})がありません`);
  return value;
};

export const buildLineLoginUrl = (state: string, redirectUri: string) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requireEnv("LINE_LOGIN_CHANNEL_ID"),
    redirect_uri: redirectUri,
    state,
    scope: "profile openid",
    // 公式アカウントの友だち追加の画面も出す(友だちでないと通知が届かないため)
    bot_prompt: "aggressive",
  });

  return `${LINE_AUTHORIZE_URL}?${params.toString()}`;
};

// 認可コードをアクセストークンに換える。トークンは ID を取るためだけに使い、保存しない(EV-11)
export const exchangeCodeForAccessToken = async (code: string, redirectUri: string) => {
  const response = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: requireEnv("LINE_LOGIN_CHANNEL_ID"),
      client_secret: requireEnv("LINE_LOGIN_CHANNEL_SECRET"),
    }),
  });

  if (!response.ok) {
    throw new Error(`LINEトークン取得エラー: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token as string;
};

export const getLineProfile = async (accessToken: string) => {
  const response = await fetch(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`LINEプロフィール取得エラー: ${response.status}`);
  }

  const data = await response.json();
  return data as { userId: string; displayName: string; pictureUrl?: string };
};
