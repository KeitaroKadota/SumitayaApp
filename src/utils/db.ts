// Supabase(PostgreSQL)への接続。みるきーの pgSheets.ts の接続部分を流用した(CMN-01 01 7.1)。
// シート方式の読み書き(全列 text・テーブルの自動作成)は持ってこない。テーブルは db/migrations/ の SQL で作る。
// 接続は最初に問い合わせたときに作る(ビルドのときにはDBへつながない)。
import postgres from "postgres";

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;
// トランザクションの中でも外でも使える問い合わせの型(共通関数が呼ぶ側のトランザクションを受け取れるようにするため)
export type SqlLike = postgres.ISql;
// where などに埋め込む SQL の部品(sql`...` の値)
export type SqlFragment = postgres.PendingQuery<postgres.Row[]>;

let client: Sql | null = null;

// Vercelのサーバーレス関数では接続を使い回せないため、1インスタンスにつき1接続とし、
// Supabaseの接続プーラー(Transaction pooler)経由で使う。プーラーはプリペアドステートメント非対応。
const getClient = (): Sql => {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL が設定されていません");
    client = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 1,
      ssl: "require",
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return client;
};

// 接続プーラー経由で1本の接続に複数の問い合わせを同時に流すと詰まるため、問い合わせは1つずつ順番に流す。
// 一定時間たっても返らない場合は、その接続を捨てて作り直し(次の問い合わせから新しい接続を使う)、エラーにする。
const DEFAULT_TIMEOUT_MS = 15000;
let chain: Promise<unknown> = Promise.resolve();

const run = <T>(fn: (sql: Sql) => PromiseLike<T>, timeoutMs: number): Promise<T> => {
  const task = chain.then(async () => {
    const sql = getClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(fn(sql)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            if (client === sql) client = null;
            void sql.end({ timeout: 0 }).catch(() => {});
            reject(new Error("データベースの応答がありません(タイムアウト)"));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
  chain = task.then(
    () => undefined,
    () => undefined
  );
  return task;
};

// 問い合わせを1つ流す。例: const rows = await query((sql) => sql`select ... where id = ${id}`);
export const query = <T>(fn: (sql: Sql) => PromiseLike<T>, options?: { timeoutMs?: number }): Promise<T> =>
  run(fn, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

// tx を渡されたらそのトランザクションの中で、無ければ query で流す(CMN-03 の createTask など)
export const queryOn = <T>(tx: TransactionSql | undefined, fn: (sql: SqlLike) => PromiseLike<T>): Promise<T> =>
  tx ? Promise.resolve(fn(tx)) : query(fn);

// 1つのトランザクションの中で複数の問い合わせを流す。fn が例外を投げたら全部取り消す(ロールバック)。
// CSVの取り込み(A-01 など)のように時間がかかる処理は timeoutMs を長めに渡す。
export const transaction = <T>(fn: (tx: TransactionSql) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> =>
  run((sql) => sql.begin((tx) => fn(tx)) as Promise<T>, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
