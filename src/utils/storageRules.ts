// 画像・PDFの保存の決まり(C-01 01 8.1、04 CH-01・CH-02、00_共通設計 7.2)。E-04・E-07 も同じものを使う。
// DBを読まない計算だけのファイルなので、画面の部品(FileUploader)からも使える。

export const STORAGE_BUCKET = "sumitaya-files";

// 用途(stored_files.purpose)
export const FILE_PURPOSES = ["delivery_slip", "received_invoice", "receipt", "other"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

// CH-01 受け付ける種類と、置き場のパスの拡張子
export const FILE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;
export type FileContentType = keyof typeof FILE_TYPES;
export const IMAGE_TYPES: readonly FileContentType[] = ["image/jpeg", "image/png", "image/webp"];
export const isFileContentType = (value: string): value is FileContentType => Object.hasOwn(FILE_TYPES, value);

// CH-02 大きさ。画像はサーバー経由(縮小のあと4MBまで)、PDFは署名付きURLで直接(10MBまで)
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

// 画像の縮小(端末で長い辺2,000px・JPEG品質0.85。C-01 01 8.1)
export const IMAGE_MAX_SIDE = 2000;
export const IMAGE_JPEG_QUALITY = 0.85;

// 署名付きのアップロード用URL(2分【仮】)と、見るための期限付きURL(10分)の有効時間(秒。00_共通設計 7.2)
export const UPLOAD_URL_TTL_SECONDS = 120;
export const VIEW_URL_TTL_SECONDS = 600;

// 画面とサーバーで同じ文を出す(E-04 04 CH-02 の文)
export const FILE_MESSAGES = {
  type: "画像（JPEG・PNG・WebP）かPDFを選んでください。",
  pdfTooLarge: "PDFは10MBまでにしてください。",
  imageTooLarge: "写真が大きすぎます。撮り直してください。",
  empty: "空のファイルです。もう一度選んでください。",
  notConfigured: "ファイルの保存先が未設定です。",
  sendFailed: "ファイルを送れませんでした。時間をおいてもう一度お試しください。",
  saveFailed: "ファイルを保存できませんでした。時間をおいてもう一度お試しください。",
  unusable: "このファイルは使えません。もう一度選んでください。",
  unreadableImage: "この画像は読み込めませんでした。",
} as const;

// ファイルの送り先(各機能の Route Handler)が返す形
export type FileUploadResponse =
  | { ok: true; id: string; duplicateOf: string | null }
  | { ok: true; uploadUrl: string; ticket: string }
  | { ok: false; error: string };
