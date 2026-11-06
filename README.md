# SumitayaApp

株式会社祭すみたや様向けの業務支援システム（AIエージェント導入）。

## 構成

- Next.js 16（App Router）＋ TypeScript
- Tailwind CSS
- Supabase（PostgreSQL）。接続は `postgres`（`src/utils/db.ts`）
- ログイン状態の署名は `jose`
- Vercel（main が本番、作業ブランチは Preview）

## 開発

```bash
npm install
npm run dev
```

http://localhost:3000 で確認できる。

## 環境変数

`.env.local`（開発）と Vercel の設定（本番）に入れる。**値はリポジトリに書かない。**
`.env.local` は Git に載らないので、Vercel には Settings → Environment Variables で別に入れ、入れたあとに Redeploy する。

| 名前 | 用途 |
|---|---|
| `DATABASE_URL` | Supabase の接続URL（Transaction pooler） |
| `SESSION_SECRET` | ログイン状態・再設定リンクの署名に使う秘密の文字列（32文字以上） |
| `SITE_URL` | メールに書くURLの起点（例: Vercel の本番URL。末尾の `/` は不要） |
| `MAIL_FROM_ADDRESS` | メールの送信元のアドレス（Gmail API で送るアカウント。当面は角田さんの Gmail） |
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
| `SUPABASE_SERVICE_ROLE_KEY` | 画像・PDF（請求書など）を Supabase Storage に保存・表示するための鍵（Supabase の Project Settings → API Keys の、従来の形式（Legacy）の `service_role` キー。みるきーと同じ。新しい形式の secret キー（`sb_secret_…`）で動くかは未確認）。**サーバー専用。画面・ログに出さない**。無いときは「ファイルの保存先が未設定です。」になり、ファイルの登録ができない（手入力はできる） |
| `SUPABASE_URL` | （任意）Supabase のプロジェクトのURL（例: `https://xxxx.supabase.co`）。空なら `DATABASE_URL` の接続ユーザー名（`postgres.<プロジェクトID>`）から求める |
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
  - 画像・PDFの記録（C-01 の共通の仕組み）と受け取った請求書（E-04）は `0024_C-01_stored_files.sql` → `0025_E-04_received_invoices.sql`（0023 の後）
  - 自社の情報と発行する請求書（E-05）は `0026_E-05_company_settings.sql` → `0027_E-05_invoices.sql`（0025 の後）。自社の情報の値は入っていない（下の「自社の情報」）
- すべてのテーブルで RLS を有効にしている。アプリはサーバーからだけ接続する。

## 自社の情報（請求書・発注書に載せる）

請求書（E-05）・発注書（A-03）に載せる会社名・登録番号・振込先は、テーブル `company_settings`（1行だけ）に入れる。
画面からは直せない。値はすみたや様の実データなので、**リポジトリ（このファイルやSQLのファイル）には書かない**。
Supabase の SQL Editor で、次の例の値を実際のものに置き換えて実行する（`0026` の後）。会社名と登録番号が空のあいだは、請求書を発行できない（下書きは作れる）。

```sql
insert into public.company_settings (
  id, company_name, postal_code, address, tel, fax, email, registration_no,
  bank_name, bank_branch, bank_account_type, bank_account_no, bank_account_holder, rounding
) values (
  1, 'ここに会社名', '000-0000', 'ここに住所', '000-000-0000', null, null, 'T0000000000000',
  'ここに銀行名', 'ここに支店名', '普通', '0000000', 'ここに口座名義（カナ）', 'floor'
)
on conflict (id) do update set
  company_name = excluded.company_name, postal_code = excluded.postal_code, address = excluded.address,
  tel = excluded.tel, fax = excluded.fax, email = excluded.email, registration_no = excluded.registration_no,
  bank_name = excluded.bank_name, bank_branch = excluded.bank_branch, bank_account_type = excluded.bank_account_type,
  bank_account_no = excluded.bank_account_no, bank_account_holder = excluded.bank_account_holder,
  rounding = excluded.rounding;
```

- 登録番号は `T` と数字13けた（ハイフン・空白は発行のときに取り除く）。登録されているかは、国税庁の公表サイトで人が確かめる。
- `bank_account_type` は `普通` か `当座`。振込先が空なら、請求書に振込先の欄を出さない。
- `rounding` は消費税の端数処理（`floor` 切り捨て・`round` 四捨五入・`ceil` 切り上げ）。【仮】切り捨て。
- 発行済みの請求書は発行のときの値を写して持つので、後で値を直しても変わらない（下書きと、これから発行する請求書に効く）。

## 画像・PDFの置き場（Supabase Storage）

請求書（E-04）・納品書（C-01）・領収書（E-07）の画像・PDFは、Supabase Storage のバケット `sumitaya-files` に置く。
最初にファイルを保存するときにアプリが自動で作るが、設定を確かめるため、先に画面で作っておく。

1. Supabase のプロジェクトの **Storage** を開き、**New bucket** を押す。
2. Name に `sumitaya-files` と入れ、**Public bucket はオフ**（非公開）のままにする。
3. 追加の設定（Additional configuration）で、ファイルの大きさの上限を `10 MB`、受け付ける種類（Allowed MIME types）を `image/jpeg, image/png, image/webp, application/pdf` にして作る（画面の項目名は Supabase の版で少し違うことがある）。
4. ポリシー（Policies）は作らない（アプリはサーバーから `SUPABASE_SERVICE_ROLE_KEY` で操作し、ブラウザには直接見せない。見るときは10分だけ使えるURLを毎回作る）。

- 画像は端末で長い辺2,000pxに縮小してからサーバー経由で送る（4MBまで）。PDF はサーバーが出す署名付きのアップロード用URLで、ブラウザから Storage へ直接送る（10MBまで）。
- 消したファイルは記録（`stored_files.deleted_at`）だけ先に消える。置き場の実物は30日後に手で消す。送っただけで記録されなかったファイル（途中で画面を閉じたなど）も置き場に残るので、ときどき `stored_files` に無いものを手で消す（自動化は後で）。

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
