// 画像・PDFの保存の共通の仕組み(C-01 01 8章、03 EV-02・EV-02B・EV-03、04 CH-01〜CH-03、00_共通設計 7.2)。
// C-01(納品書)・E-04(請求書)・E-07(領収書)がこの関数を使う。サーバー専用(SUPABASE_SERVICE_ROLE_KEY を使う。画面には出さない)。
// みるきーの supabaseStorage.ts を流用した(プロジェクトのURLの求め方、置き場を作る ensureBucket、上げる・消す・期限付きURL)。
// 変えた点: 置き場を sumitaya-files に、PDF を受け付けて上限を10MBに、署名付きのアップロード用URLを足した、
// stored_files への記録と指紋(sha256)を足した、論理削除にした、見るURLの有効時間を10分にした。
// Storage の REST API を fetch で呼ぶ(ライブラリは入れない。みるきーと同じ)。
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { query } from "@/utils/db";
import { getSessionSecret } from "@/utils/session";
import {
  FILE_MESSAGES,
  FILE_TYPES,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  STORAGE_BUCKET,
  UPLOAD_URL_TTL_SECONDS,
  VIEW_URL_TTL_SECONDS,
  isFileContentType,
  type FileContentType,
  type FilePurpose,
} from "@/utils/storageRules";

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("ファイルの保存先が未設定です(SUPABASE_SERVICE_ROLE_KEY)");
  }
}

// SUPABASE_URL が無いときは、DATABASE_URL の接続ユーザー名(postgres.<プロジェクトID>)からプロジェクトのURLを求める
const projectUrl = (): string | null => {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/$/, "");
  const db = process.env.DATABASE_URL;
  if (!db) return null;
  try {
    const user = decodeURIComponent(new URL(db).username);
    const ref = user.startsWith("postgres.") ? user.slice("postgres.".length) : "";
    return ref ? `https://${ref}.supabase.co` : null;
  } catch {
    return null;
  }
};

// 置き場の設定(環境変数)があるか
export const isStorageConfigured = (): boolean => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && projectUrl());

const config = () => {
  const url = projectUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StorageNotConfiguredError();
  return { base: `${url}/storage/v1`, headers: { Authorization: `Bearer ${key}`, apikey: key } };
};

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

let bucketReady = false;

// 置き場が無ければ作る(非公開・1ファイル10MBまで・4種類)。既にあればそのまま(README の手順で先に作っておいてもよい)
const ensureBucket = async () => {
  if (bucketReady) return;
  const { base, headers } = config();
  const res = await fetch(`${base}/bucket/${STORAGE_BUCKET}`, { headers, cache: "no-store" });
  if (res.ok) {
    bucketReady = true;
    return;
  }
  const created = await fetch(`${base}/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: STORAGE_BUCKET,
      name: STORAGE_BUCKET,
      public: false,
      file_size_limit: MAX_PDF_BYTES,
      allowed_mime_types: Object.keys(FILE_TYPES),
    }),
  });
  // 同時に作られた場合(既にある)も成功として扱う
  if (!created.ok && created.status !== 409) {
    const body = await created.text();
    if (!body.includes("already exists")) throw new Error(`ファイルの置き場を作れませんでした: HTTP ${created.status}`);
  }
  bucketReady = true;
};

const uploadObject = async (path: string, bytes: Uint8Array, contentType: string): Promise<void> => {
  await ensureBucket();
  const { base, headers } = config();
  const res = await fetch(`${base}/object/${STORAGE_BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType, "x-upsert": "false" },
    body: Buffer.from(bytes),
  });
  if (!res.ok) throw new Error(`ファイルを保存できませんでした: HTTP ${res.status}`);
};

const downloadObject = async (path: string): Promise<Uint8Array | null> => {
  const { base, headers } = config();
  const res = await fetch(`${base}/object/${STORAGE_BUCKET}/${encodePath(path)}`, { headers, cache: "no-store" });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`ファイルを読めませんでした: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

// 置き場の実物を消す(既に無いものは気にしない)。記録の無いファイルを残さないために使う
const deleteObjects = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const { base, headers } = config();
  const res = await fetch(`${base}/object/${STORAGE_BUCKET}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok && res.status !== 404) throw new Error(`ファイルを削除できませんでした: HTTP ${res.status}`);
};

const deleteObjectQuietly = async (path: string) => {
  try {
    await deleteObjects([path]);
  } catch (e) {
    console.error("置き場のファイルを消せませんでした:", e instanceof Error ? e.message : e);
  }
};

// ---- CH-01・CH-02 ----

// CH-01 先頭のバイトで種類を確かめる(JPEG は FF D8、PNG は 89 50 4E 47、WebP は RIFF….WEBP、PDF は %PDF)
export const sniffContentType = (bytes: Uint8Array): FileContentType | null => {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF") return "application/pdf";
  return null;
};

// CH-02 送り方ごとの上限
const sizeError = (contentType: FileContentType, size: number): string | null => {
  if (size < 1) return FILE_MESSAGES.empty;
  if (contentType === "application/pdf") return size > MAX_PDF_BYTES ? FILE_MESSAGES.pdfTooLarge : null;
  return size > MAX_IMAGE_BYTES ? FILE_MESSAGES.imageTooLarge : null;
};

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// <用途>/<年>/<月>/<id>.<拡張子>(年月は日本時間)
const buildPath = (purpose: FilePurpose, id: string, contentType: FileContentType): string => {
  const ym = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7);
  return `${purpose}/${ym.slice(0, 4)}/${ym.slice(5, 7)}/${id}.${FILE_TYPES[contentType]}`;
};

const cleanName = (name: string, contentType: FileContentType): string =>
  name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 255) || `file.${FILE_TYPES[contentType]}`;

export type SavedFile = { id: string; duplicateOf: string | null };
export type StorageResult<T> = ({ ok: true } & T) | { ok: false; error: string };

// stored_files に1行足し、CH-03 同じ指紋・同じ用途の消していないファイルを探す
const recordFile = async (row: {
  id: string;
  path: string;
  purpose: FilePurpose;
  originalName: string;
  contentType: FileContentType;
  size: number;
  sha256: string;
  by: string;
}): Promise<SavedFile> => {
  await query(
    (sql) => sql`
      insert into stored_files (id, bucket, path, purpose, original_name, content_type, size_bytes, sha256, created_by, updated_by)
      values (${row.id}, ${STORAGE_BUCKET}, ${row.path}, ${row.purpose}, ${row.originalName}, ${row.contentType},
              ${row.size}, ${row.sha256}, ${row.by}, ${row.by})`
  );
  const [dup] = await query(
    (sql) => sql<{ id: string }[]>`
      select id from stored_files
      where sha256 = ${row.sha256} and purpose = ${row.purpose} and deleted_at is null and id <> ${row.id}
      order by created_at limit 1`
  );
  return { id: row.id, duplicateOf: dup?.id ?? null };
};

// ---- EV-02 saveFile 画像をサーバー経由で保存して記録する ----

export const saveFile = async ({
  bytes,
  contentType,
  originalName,
  purpose,
  by,
}: {
  bytes: Uint8Array;
  contentType: string;
  originalName: string;
  purpose: FilePurpose;
  by: string;
}): Promise<StorageResult<SavedFile>> => {
  if (!isStorageConfigured()) return { ok: false, error: FILE_MESSAGES.notConfigured };
  // 手順1: CH-01(申告の種類と先頭のバイトが同じ画像)・CH-02
  const sniffed = sniffContentType(bytes);
  if (!isFileContentType(contentType) || !IMAGE_TYPES.includes(contentType) || sniffed !== contentType)
    return { ok: false, error: FILE_MESSAGES.type };
  const tooLarge = sizeError(contentType, bytes.byteLength);
  if (tooLarge) return { ok: false, error: tooLarge };

  // 手順2・3
  const id = randomUUID();
  const path = buildPath(purpose, id, contentType);
  const hash = sha256Hex(bytes);

  // 手順4・5
  try {
    await uploadObject(path, bytes, contentType);
  } catch (e) {
    console.error("ファイルを置き場に上げられませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, error: FILE_MESSAGES.saveFailed };
  }

  // 手順6・7: 書けなければ置き場の実物を消す(記録の無いファイルを残さない)
  try {
    const saved = await recordFile({
      id,
      path,
      purpose,
      originalName: cleanName(originalName, contentType),
      contentType,
      size: bytes.byteLength,
      sha256: hash,
      by,
    });
    return { ok: true, ...saved };
  } catch (e) {
    console.error("ファイルを記録できませんでした:", e instanceof Error ? e.message : e);
    await deleteObjectQuietly(path);
    return { ok: false, error: FILE_MESSAGES.saveFailed };
  }
};

// ---- EV-02B createUploadUrl・registerUploadedFile PDF・大きいファイルを直接送って記録する ----

// 送り先の引換券(どの id・パス・用途・人のためのURLか)。改ざんできないよう SESSION_SECRET で署名する。
// 【仮】Supabase の署名付きアップロード用URLの有効時間は Supabase 側で決まっていて(既定2時間)こちらで2分にできないため、
// 2分の決まりはこの引換券の期限で守る(登録は発行から2分以内。00_仮決め一覧 C-01-仮-09)
type UploadTicket = { fid: string; path: string; purpose: FilePurpose; by: string; ct: FileContentType; name: string };

const signTicket = (t: UploadTicket) =>
  new SignJWT({ ...t, use: "file_upload" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${UPLOAD_URL_TTL_SECONDS}s`)
    .sign(getSessionSecret());

const verifyTicket = async (token: string): Promise<UploadTicket | null> => {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), { algorithms: ["HS256"] });
    if (payload.use !== "file_upload") return null;
    const { fid, path, purpose, by, ct, name } = payload as Record<string, unknown>;
    if (typeof fid !== "string" || typeof path !== "string" || typeof purpose !== "string" || typeof by !== "string") return null;
    if (typeof ct !== "string" || !isFileContentType(ct) || typeof name !== "string") return null;
    return { fid, path, purpose: purpose as FilePurpose, by, ct, name };
  } catch {
    return null;
  }
};

// 引換券のパスが「<用途>/<年>/<月>/<id>.<拡張子>」の形か(年月は発行した月なので、形だけを見る)
const buildPathFor = (t: UploadTicket): string => {
  const m = t.path.match(/^([a-z_]+)\/(\d{4})\/(\d{2})\/([0-9a-f-]{36})\.([a-z]+)$/);
  if (!m || m[1] !== t.purpose || m[4] !== t.fid || m[5] !== FILE_TYPES[t.ct]) return "";
  return t.path;
};

export const createUploadUrl = async ({
  contentType,
  sizeBytes,
  originalName,
  purpose,
  by,
}: {
  contentType: string;
  sizeBytes: number;
  originalName: string;
  purpose: FilePurpose;
  by: string;
}): Promise<StorageResult<{ uploadUrl: string; ticket: string }>> => {
  if (!isStorageConfigured()) return { ok: false, error: FILE_MESSAGES.notConfigured };
  // 手順2: CH-01(申告された種類)・CH-02(申告された大きさ)。この時点では stored_files に書かない
  if (!isFileContentType(contentType)) return { ok: false, error: FILE_MESSAGES.type };
  if (!Number.isInteger(sizeBytes)) return { ok: false, error: FILE_MESSAGES.unusable };
  const tooLarge = sizeError(contentType, sizeBytes);
  if (tooLarge) return { ok: false, error: tooLarge };

  const id = randomUUID();
  const path = buildPath(purpose, id, contentType);
  try {
    await ensureBucket();
    const { base, headers } = config();
    const res = await fetch(`${base}/object/upload/sign/${STORAGE_BUCKET}/${encodePath(path)}`, {
      method: "POST",
      headers: { ...headers, "x-upsert": "false" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { url?: string };
    if (!json.url) throw new Error("URL が返りませんでした");
    const ticket = await signTicket({ fid: id, path, purpose, by, ct: contentType, name: cleanName(originalName, contentType) });
    return { ok: true, uploadUrl: `${base}${json.url}`, ticket };
  } catch (e) {
    console.error("アップロード用のURLを作れませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, error: FILE_MESSAGES.sendFailed };
  }
};

export const registerUploadedFile = async ({
  ticket,
  purpose,
  by,
}: {
  ticket: string;
  purpose: FilePurpose;
  by: string;
}): Promise<StorageResult<SavedFile>> => {
  if (!isStorageConfigured()) return { ok: false, error: FILE_MESSAGES.notConfigured };
  // 手順5: 引換券が本物で期限内、同じ用途・同じ人のもの、パスが決めた形か
  const t = await verifyTicket(ticket);
  if (!t || t.purpose !== purpose || t.by !== by || t.path !== buildPathFor(t)) return { ok: false, error: FILE_MESSAGES.unusable };

  let bytes: Uint8Array | null;
  try {
    bytes = await downloadObject(t.path);
  } catch (e) {
    console.error("送られたファイルを読めませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, error: FILE_MESSAGES.sendFailed };
  }
  if (!bytes) return { ok: false, error: FILE_MESSAGES.sendFailed };

  // CH-01(先頭のバイト)・CH-02(実際の大きさ)を確かめ直す。だめなら置き場の実物を消す
  if (sniffContentType(bytes) !== t.ct || sizeError(t.ct, bytes.byteLength)) {
    await deleteObjectQuietly(t.path);
    return { ok: false, error: sizeError(t.ct, bytes.byteLength) ?? FILE_MESSAGES.unusable };
  }

  // 手順6: 指紋を作って記録する。書けなければ置き場の実物を消す
  try {
    const saved = await recordFile({
      id: t.fid,
      path: t.path,
      purpose,
      originalName: t.name,
      contentType: t.ct,
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
      by,
    });
    return { ok: true, ...saved };
  } catch (e) {
    console.error("送られたファイルを記録できませんでした:", e instanceof Error ? e.message : e);
    await deleteObjectQuietly(t.path);
    return { ok: false, error: FILE_MESSAGES.saveFailed };
  }
};

// ---- EV-03 getSignedUrls 見るための期限付きURL ----

// 呼ぶ画面が自分の権限を確かめたあとに呼ぶ(01 の 8.4)。ファイルID → URL。作れなかったものは入れない(画面は「表示できません」)
export const getSignedUrls = async (fileIds: string[], expiresIn = VIEW_URL_TTL_SECONDS): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const ids = [...new Set(fileIds)];
  if (ids.length === 0 || !isStorageConfigured()) return result;
  try {
    const rows = await query(
      (sql) => sql<{ id: string; path: string }[]>`
        select id, path from stored_files where id = any(${ids}::uuid[]) and deleted_at is null`
    );
    if (rows.length === 0) return result;
    const { base, headers } = config();
    const res = await fetch(`${base}/object/sign/${STORAGE_BUCKET}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn, paths: rows.map((r) => r.path) }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("ファイルのURLを作れませんでした:", `HTTP ${res.status}`);
      return result;
    }
    const items = (await res.json()) as { path?: string; signedURL?: string | null }[];
    const byPath = new Map(rows.map((r) => [r.path, r.id]));
    for (const item of items) {
      const id = item.path ? byPath.get(item.path) : undefined;
      if (id && item.signedURL) result.set(id, `${base}${item.signedURL}`);
    }
  } catch (e) {
    console.error("ファイルのURLを作れませんでした:", e instanceof Error ? e.message : e);
  }
  return result;
};

export type StoredFileInfo = {
  id: string;
  purpose: FilePurpose;
  originalName: string;
  contentType: FileContentType;
  sizeBytes: number;
  sha256: string;
  createdBy: string | null;
  createdAt: Date;
};

// 記録を読む(論理削除したものは返さない)
export const getStoredFile = async (fileId: string): Promise<StoredFileInfo | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const [row] = await query(
    (sql) => sql<
      {
        id: string;
        purpose: FilePurpose;
        original_name: string;
        content_type: FileContentType;
        size_bytes: number;
        sha256: string;
        created_by: string | null;
        created_at: Date;
      }[]
    >`
      select id, purpose, original_name, content_type, size_bytes, sha256, created_by, created_at
      from stored_files where id = ${fileId} and deleted_at is null`
  );
  if (!row) return null;
  return {
    id: row.id,
    purpose: row.purpose,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
};

// 中身を読む(Gemini に送るため)。見つからなければ null
export const getFileBytes = async (fileId: string): Promise<{ bytes: Uint8Array; contentType: FileContentType } | null> => {
  const [row] = await query(
    (sql) => sql<{ path: string; content_type: FileContentType }[]>`
      select path, content_type from stored_files where id = ${fileId} and deleted_at is null`
  );
  if (!row) return null;
  const bytes = await downloadObject(row.path);
  return bytes ? { bytes, contentType: row.content_type } : null;
};

// 論理削除(置き場の実物は30日後に手で消す。00_仮決め一覧 C-01-仮-08)
export const deleteFile = async (fileId: string, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update stored_files set deleted_at = now(), deleted_by = ${by}, updated_by = ${by}
      where id = ${fileId} and deleted_at is null`
  );
};
