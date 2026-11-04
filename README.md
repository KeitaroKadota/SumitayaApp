# SumitayaApp

株式会社祭すみたや様向けの業務支援システム（AIエージェント導入）。

## 構成

- Next.js 16（App Router）＋ TypeScript
- Tailwind CSS
- Supabase（PostgreSQL）。接続は `postgres`（`src/utils/db.ts`）
- ログイン状態の署名は `jose`
- Vercel ※導入予定

## 開発

```bash
npm install
npm run dev
```

http://localhost:3000 で確認できる。

## 環境変数

`.env.local`（開発）と Vercel の設定（本番）に入れる。**値はリポジトリに書かない。**

| 名前 | 用途 |
|---|---|
| `DATABASE_URL` | Supabase の接続URL（Transaction pooler） |
| `SESSION_SECRET` | ログイン状態・再設定リンクの署名に使う秘密の文字列（32文字以上） |
| `SITE_URL` | メールに書くURLの起点（例: Vercel の本番URL。末尾の `/` は不要） |
| `MAIL_FROM_ADDRESS` | メールの送信元のアドレス（Gmail API で送るアカウント。当面は門田さんの Gmail） |
| `GOOGLE_OAUTH_CLIENT_ID` | Gmail API でメールを送るための OAuth クライアントID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 同じく OAuth クライアントシークレット |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | 同じく送信元のアカウント（`MAIL_FROM_ADDRESS`）で発行したリフレッシュトークン（`gmail.send`） |
| `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` | タスクの通知を送る LINE 公式アカウント（Messaging API）のチャネルアクセストークン（長期） |
| `LINE_LOGIN_CHANNEL_ID` | 従業員の LINE を通知のために結び付ける「LINEログイン」のチャネルID（上の公式アカウントと同じプロバイダーに作る） |
| `LINE_LOGIN_CHANNEL_SECRET` | 同じく LINEログインのチャネルシークレット |
| `LINE_NOTIFY_ENABLED` | `1` のときだけ実際に LINE へ送る。それ以外は送らずに記録だけ残す（試運転用） |
| `LINE_DAILY_PUSH_LIMIT` | 1日に送る LINE の上限の通数（空なら 30） |
| `GEMINI_API_KEY` | AI（Gemini）の APIキー。無いときは AI は「停止中」の扱いになり、種類は手で選ぶ（取り込み・手での分類・返信の記録は使える） |
| `GEMINI_MODEL` | 使うモデル名。空なら `gemini-3.5-flash-lite`（無料版でも使える安定版の軽いモデル） |
| `AI_DAILY_LIMIT` | 1日の上限の回数（参考の表示用。空なら 20） |
| `AI_STOP_AT` | この回数に達したら AI を止める（空なら 18）。1日の区切りは太平洋時間の0時（日本の16時か17時） |
| `AI_WARN_AT` | この回数に達したら「残りわずか」を出し、取り込みのときの自動の分類をやめる（空なら 15） |
| `CRON_SECRET` | 毎朝の定期実行（`/api/cron/daily`）の合言葉（16文字以上のランダムな文字列）。Vercel に設定すると、Cron が呼ぶときに自動で付けて送る |

- ビルドのときはDBにつながない（DBには最初の問い合わせのときにつなぐ）。
- メールの設定が無いときは、送信の操作がエラーになり、メールは送られない。
- LINE の設定が無いとき・`LINE_NOTIFY_ENABLED` が `1` でないときは、LINE は送られない（タスクは画面で見られる）。
- AI の回数は全機能で共有して数える（`ai_requests` の行）。キー・モデル・回数は環境変数だけで変えられる（有料のキーに切り替えるときもコードは直さない）。有料版にしたら `AI_DAILY_LIMIT`・`AI_STOP_AT`・`AI_WARN_AT` を契約に合わせて上げる。
- **Gemini の無料版のキーでは、送った内容が Google のサービスの改善に使われることがある。お試しの間は実際のお客様のメールを使わず、架空の文面で確かめる。**（本文のメールアドレス・電話番号は伏せて送るが、名前などは伏せない）
- AI のエラー（キーが無い・キーが間違い・回数の上限・モデル名の間違い）は画面に文で出し、種類は手で選べる。キー・モデル名の間違いは `ai_requests.error_message` に Google のエラーの種類（例: `HTTP 400 INVALID_ARGUMENT API_KEY_INVALID`）が残る。
- `SITE_URL` は LINE の本文のリンクと、LINEログインの戻り先（`{SITE_URL}/auth/line/link/callback`）にも使う。

## データベース

- テーブルは `db/migrations/` の SQL で作る。番号の順に、Supabase の SQL Editor で1回ずつ実行する。
  - `0001_E-01_work_locations.sql`（打刻の場所・共通のトリガー）→ `0002_CMN-02_employees.sql`（従業員）→ … → `0017_D-04_custom_quotes.sql`
  - タスク・通知（CMN-03）は `0008_CMN-03_tasks.sql` → `0009_CMN-03_notification_logs.sql` → `0010_CMN-03_cron_runs.sql`
  - 問い合わせ・AI（D-01）は `0011_D-01_inquiries.sql` → `0012_D-01_inquiry_replies.sql` → `0013_D-01_ai_requests.sql`（0010 の後）
  - 返信のひな形（D-02 の担当。D-03 が先に使う）とよくある質問（D-03）は `0014_D-02_reply_templates.sql` → `0015_D-03_faq_entries.sql`（0013 の後）
  - 特注の単価表・案件（D-04）は `0016_D-04_custom_price_items.sql` → `0017_D-04_custom_quotes.sql`（0015 の後）。単価の値は入れていない（画面で登録する）
- すべてのテーブルで RLS を有効にしている。アプリはサーバーからだけ接続する。

## 定期実行（cron）

- 入口は `/api/cron/daily` の1つだけ。`vercel.json` で毎朝7:00（日本時間。UTC `0 22 * * *`）に動く。
- 中で動く処理は `src/utils/cron.ts` の `DAILY_JOBS` に登録する（最後は毎朝のまとめ通知）。同じ日の二重実行は `cron_runs` で防ぐ。

## 最初の社長アカウント

画面からは作れないので、SQL を実行した後に次のスクリプトで1件だけ作る（値は実際のものに置き換える）。

```bash
node --env-file=.env.local scripts/create-president.mjs --code 001 --last 姓 --first 名 --login ログインID [--email メール] [--department office]
```

初期パスワードは画面に1回だけ表示される。社長に直接伝え、初回ログインのときに変えてもらう。

## 注意

- 要件定義・設計書・議事録はこのリポジトリに入れない（`すみたやプロジェクト` の各フォルダで管理）。
- すみたや様からいただいた実データ（売上・従業員・入出金など）はコミットしない。
- 環境変数（`.env*`）はコミットしない。
