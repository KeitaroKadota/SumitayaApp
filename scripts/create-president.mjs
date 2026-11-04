// 最初の社長アカウントを1件だけ作るスクリプト(CMN-01 01 7.3)。画面からは作れないため、開発者が実行する。
// 使い方(SumitayaApp のフォルダで。値は実際のものに置き換える):
//   node --env-file=.env.local scripts/create-president.mjs --code 001 --last 姓 --first 名 --login ログインID [--email メール] [--department office]
// 初期パスワードは画面に1回だけ出す(DBには暗号化したものだけを保存)。社長に直接伝え、初回ログイン時に変えてもらう。
import { parseArgs } from "node:util";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";

// src/utils/password.ts と同じ作り方(salt:hash の形)。変えるときは両方を直す
const scryptAsync = promisify(scrypt);
const hashPassword = async (password) => {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
};
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const generatePassword = (length = 10) =>
  Array.from(randomBytes(length), (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");

const fail = (message) => {
  console.error(`エラー: ${message}`);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    code: { type: "string" },
    last: { type: "string" },
    first: { type: "string" },
    login: { type: "string" },
    email: { type: "string" },
    // 【仮】所属は必須の列なので、指定が無ければ事務(office)にする(00_仮決め一覧 CMN01-仮-16)
    department: { type: "string", default: "office" },
  },
});

const code = values.code?.trim();
const lastName = values.last?.trim();
const firstName = values.first?.trim();
const loginId = values.login?.trim().toLowerCase();
const email = values.email?.trim() || null;
const department = values.department?.trim();

if (!code || !lastName || !firstName || !loginId) {
  fail("--code(社員番号)・--last(姓)・--first(名)・--login(ログインID)を指定してください。");
}
// CMN-01 CH-04
if (!/^[a-z0-9._-]{3,20}$/.test(loginId)) {
  fail("ログインIDは、半角の英字・数字・「-」「_」「.」の3〜20文字にしてください。");
}
if (!["store", "factory", "office"].includes(department)) {
  fail("--department は store・factory・office のどれかにしてください。");
}
if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) fail("メールアドレスの形が正しくありません。");
if (!process.env.DATABASE_URL) fail("DATABASE_URL が設定されていません(.env.local)。");

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: "require", connect_timeout: 15 });

try {
  // 最初の1件だけを作る。すでに社長がいれば作らない(2人目からは画面で登録する)
  const [{ count: presidents }] = await sql`
    select count(*)::int as count from employees where 'president' = any(roles)`;
  if (presidents > 0) fail("社長のアカウントはすでにあります。2人目からは従業員の画面で登録してください。");

  const [{ count: sameCode }] = await sql`select count(*)::int as count from employees where employee_code = ${code}`;
  if (sameCode > 0) fail("その社員番号はすでに使われています。");
  const [{ count: sameLogin }] = await sql`select count(*)::int as count from employees where lower(login_id) = ${loginId}`;
  if (sameLogin > 0) fail("そのログインIDはすでに使われています。");

  const password = generatePassword(10);
  const passwordHash = await hashPassword(password);

  await sql`
    insert into employees (
      employee_code, last_name, first_name, department, email,
      login_id, password_hash, roles, must_change_password, password_changed_at
    ) values (
      ${code}, ${lastName}, ${firstName}, ${department}, ${email},
      ${loginId}, ${passwordHash}, array['president']::text[], true, now()
    )`;

  console.log("社長のアカウントを作りました。次の情報を社長に直接伝えてください(この表示は1回だけです)。");
  console.log(`  ログインID: ${loginId}`);
  console.log(`  初期パスワード: ${password}`);
  console.log("初回ログインのときに、パスワードの変更を求められます。");
} finally {
  await sql.end({ timeout: 5 });
}
