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
| `CRON_SECRET` | 毎朝の定期実行（`/api/cron/daily`）の合言葉（16文字以上のランダムな文字列）。Vercel に設定すると、Cron が呼ぶときに自動で付けて送る |

- ビルドのときはDBにつながない（DBには最初の問い合わせのときにつなぐ）。
- メールの設定が無いときは、送信の操作がエラーになり、メールは送られない。
- LINE の設定が無いとき・`LINE_NOTIFY_ENABLED` が `1` でないときは、LINE は送られない（タスクは画面で見られる）。
- `SITE_URL` は LINE の本文のリンクと、LINEログインの戻り先（`{SITE_URL}/auth/line/link/callback`）にも使う。

## データベース

- テーブルは `db/migrations/` の SQL で作る。番号の順に、Supabase の SQL Editor で1回ずつ実行する。
  - `0001_E-01_work_locations.sql`（打刻の場所・共通のトリガー）→ `0002_CMN-02_employees.sql`（従業員）→ … → `0010_CMN-03_cron_runs.sql`
  - タスク・通知（CMN-03）は `0008_CMN-03_tasks.sql` → `0009_CMN-03_notification_logs.sql` → `0010_CMN-03_cron_runs.sql`
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
