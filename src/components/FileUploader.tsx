"use client";

// 写真・PDFの撮影・アップロードの共通部品(C-01 01 8.5、03 EV-01、00_画面共通ルール 4章)。C-01・E-04・E-07 で使い回す。
// みるきーの PhotoUploader.tsx を流用した(端末での縮小、エラーの出し方、保存先が未設定のときの案内)。
// 変えた点: PDF を選べるようにした(縮小せず、送り先から署名付きURLをもらって Storage へ直接送る)、長い辺 2,000px・品質0.85、
// 1日の枚数の上限をやめて1件あたりの数(maxFiles)にした、背面のカメラ(capture)、送り先を引数(endpoint)にした、色をテーマ変数にした。
// この部品は「選ぶ・縮小する・並べる」まで。送るのは uploadPreparedFile で、いつ送るかは使う画面が決める
// (E-04 は「登録して読み取る」を押したとき。C-01 は選んだらすぐ送る)。
import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { formatQuantity } from "@/utils/format";
import {
  FILE_MESSAGES,
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_SIDE,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  type FileUploadResponse,
} from "@/utils/storageRules";

export type PreparedFile = {
  key: string;
  kind: "image" | "pdf";
  // 画像は縮小した JPEG、PDF は選んだファイルのまま
  blob: Blob;
  name: string;
  // 画像の見本(端末の中だけのURL)
  previewUrl: string | null;
};

const loadImage = (file: File): Promise<CanvasImageSource & { width: number; height: number }> =>
  createImageBitmap(file, { imageOrientation: "from-image" }).catch(
    () =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(FILE_MESSAGES.unreadableImage));
        img.src = URL.createObjectURL(file);
      })
  );

// 向きを直して、長い辺 2,000px・JPEG(品質0.85)に縮小する
const resizeToJpeg = async (file: File): Promise<Blob> => {
  const img = await loadImage(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(FILE_MESSAGES.unreadableImage))), "image/jpeg", IMAGE_JPEG_QUALITY)
  );
};

const sizeText = (bytes: number) => `${formatQuantity(Math.max(1, Math.round(bytes / 1024)))}KB`;

const post = async (endpoint: string, fd: FormData): Promise<FileUploadResponse> => {
  const res = await fetch(endpoint, { method: "POST", body: fd });
  if (res.redirected) {
    // ログインが切れたときなど(requireAccess の移動)
    window.location.href = res.url;
    return { ok: false, error: FILE_MESSAGES.sendFailed };
  }
  try {
    return (await res.json()) as FileUploadResponse;
  } catch {
    return { ok: false, error: FILE_MESSAGES.sendFailed };
  }
};

// 1つ送る。画像は送り先(サーバー)へ、PDF は署名付きURLで Storage へ直接送ってから記録してもらう(EV-01 手順4・EV-02B)
export const uploadPreparedFile = async (
  endpoint: string,
  file: PreparedFile
): Promise<{ ok: true; id: string; duplicateOf: string | null } | { ok: false; error: string }> => {
  try {
    if (file.kind === "image") {
      if (file.blob.size > MAX_IMAGE_BYTES) return { ok: false, error: FILE_MESSAGES.imageTooLarge };
      const fd = new FormData();
      fd.set("intent", "image");
      fd.set("file", new File([file.blob], file.name, { type: "image/jpeg" }));
      const r = await post(endpoint, fd);
      if (!r.ok) return r;
      return "id" in r ? r : { ok: false, error: FILE_MESSAGES.sendFailed };
    }

    if (file.blob.size > MAX_PDF_BYTES) return { ok: false, error: FILE_MESSAGES.pdfTooLarge };
    const ask = new FormData();
    ask.set("intent", "pdf_url");
    ask.set("type", "application/pdf");
    ask.set("size", String(file.blob.size));
    ask.set("name", file.name);
    const issued = await post(endpoint, ask);
    if (!issued.ok) return issued;
    if (!("uploadUrl" in issued)) return { ok: false, error: FILE_MESSAGES.sendFailed };

    const put = await fetch(issued.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
      body: file.blob,
    });
    if (!put.ok) return { ok: false, error: FILE_MESSAGES.sendFailed };

    const done = new FormData();
    done.set("intent", "pdf_register");
    done.set("ticket", issued.ticket);
    const r = await post(endpoint, done);
    if (!r.ok) return r;
    return "id" in r ? r : { ok: false, error: FILE_MESSAGES.sendFailed };
  } catch {
    return { ok: false, error: FILE_MESSAGES.sendFailed };
  }
};

export function FileUploader({
  files,
  onChange,
  configured,
  maxFiles = 1,
  disabled = false,
  allowPdf = true,
  note,
}: {
  files: PreparedFile[];
  onChange: (files: PreparedFile[]) => void;
  configured: boolean;
  maxFiles?: number;
  disabled?: boolean;
  allowPdf?: boolean;
  note?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const full = files.length >= maxFiles;

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError("");
    setBusy(true);
    const picked = Array.from(list).slice(0, Math.max(0, maxFiles - files.length));
    if (list.length > picked.length) setError(`${maxFiles}つまでです。`);
    const added: PreparedFile[] = [];
    for (const f of picked) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (f.type === "application/pdf") {
        // 手順3: PDF はそのまま。10MB を超えたら選ばない
        if (!allowPdf) {
          setError(FILE_MESSAGES.type);
          continue;
        }
        if (f.size > MAX_PDF_BYTES) {
          setError(FILE_MESSAGES.pdfTooLarge);
          continue;
        }
        if (f.size === 0) {
          setError(FILE_MESSAGES.empty);
          continue;
        }
        added.push({ key, kind: "pdf", blob: f, name: f.name, previewUrl: null });
      } else if (f.type.startsWith("image/")) {
        // 手順2: 画像は縮小する。縮小しても4MBを超えたら選ばない
        try {
          const blob = await resizeToJpeg(f);
          if (blob.size > MAX_IMAGE_BYTES) {
            setError(FILE_MESSAGES.imageTooLarge);
            continue;
          }
          const name = `${f.name.replace(/\.[^.]*$/, "") || "photo"}.jpg`;
          added.push({ key, kind: "image", blob, name, previewUrl: URL.createObjectURL(blob) });
        } catch (e) {
          setError(e instanceof Error ? e.message : FILE_MESSAGES.unreadableImage);
        }
      } else {
        setError(FILE_MESSAGES.type);
      }
    }
    if (added.length > 0) onChange([...files, ...added]);
    setBusy(false);
    if (cameraRef.current) cameraRef.current.value = "";
    if (pdfRef.current) pdfRef.current.value = "";
  };

  const remove = (key: string) => {
    const target = files.find((f) => f.key === key);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onChange(files.filter((f) => f.key !== key));
  };

  if (!configured) {
    return (
      <p className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning">
        ⚠ {FILE_MESSAGES.notConfigured}（管理者に連絡してください）
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.key} className="relative flex w-32 flex-col gap-1 rounded-md border border-line bg-surface p-1 text-xs">
              {f.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.previewUrl} alt="選んだ写真" className="h-32 w-full rounded object-cover" />
              ) : (
                <span className="flex h-32 items-center justify-center rounded bg-canvas font-bold text-ink-muted">PDF</span>
              )}
              <span className="truncate" title={f.name}>
                {f.name}
              </span>
              <span className="text-ink-muted tabular-nums">{sizeText(f.blob.size)}</span>
              <button
                type="button"
                aria-label={`${f.name} を外す`}
                onClick={() => remove(f.key)}
                disabled={disabled}
                className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-ink/70 text-sm text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => cameraRef.current?.click()} disabled={disabled || busy}>
            ＋ 撮影
          </Button>
          {allowPdf && (
            <Button variant="secondary" onClick={() => pdfRef.current?.click()} disabled={disabled || busy}>
              PDFを選ぶ
            </Button>
          )}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="写真を撮る・選ぶ"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <input
            ref={pdfRef}
            type="file"
            accept="application/pdf"
            aria-label="PDFを選ぶ"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      )}
      {busy && <p className="text-sm text-primary">写真を小さくしています…</p>}
      {error && <p className="text-sm text-danger">⚠ {error}</p>}
      <p className="text-sm text-ink-muted">
        写真は自動で小さくして送ります（4MBまで）。{allowPdf ? "PDFは10MBまで。" : ""}
        {note}
      </p>
    </div>
  );
}
