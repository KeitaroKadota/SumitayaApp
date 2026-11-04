// ファイルの送り先(各機能の Route Handler)の共通の中身(C-01 03 EV-01・EV-02B)。
// 画像は Server Action では送れる大きさが1MBまでで、広げる設定(serverActions.bodySizeLimit)は試験段階の機能のため、
// 受注CSVの取り込み(B-01)と同じく Route Handler で受け取る(【仮】00_仮決め一覧 C-01-仮-10)。各機能の route.ts は requireAccess のあとにこれを呼ぶ。
// 送り方(intent):
// - image: 端末で縮小した画像(file)をそのまま送る → saveFile
// - pdf_url: PDF の種類(type)・大きさ(size)・名前(name)を送り、署名付きのアップロード用URLと引換券をもらう → createUploadUrl
// - pdf_register: 直接送り終わったら引換券(ticket)を送り、記録する → registerUploadedFile
import { isSameOrigin } from "@/utils/crossmall/importChecks";
import { createUploadUrl, registerUploadedFile, saveFile } from "@/utils/storage";
import { FILE_MESSAGES, MAX_IMAGE_BYTES, type FilePurpose, type FileUploadResponse } from "@/utils/storageRules";

const json = (body: FileUploadResponse, status = 200) => Response.json(body, { status });

export const handleFileUpload = async (
  request: Request,
  { purpose, by, allowDirectTypes }: { purpose: FilePurpose; by: string; allowDirectTypes: readonly string[] }
): Promise<Response> => {
  if (!isSameOrigin(request)) return json({ ok: false, error: "この画面から操作してください。" }, 403);
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: FILE_MESSAGES.sendFailed }, 400);
  }
  const intent = formData.get("intent");

  if (intent === "image") {
    const file = formData.get("file");
    if (!(file instanceof File)) return json({ ok: false, error: FILE_MESSAGES.type });
    if (file.size > MAX_IMAGE_BYTES) return json({ ok: false, error: FILE_MESSAGES.imageTooLarge });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await saveFile({ bytes, contentType: file.type, originalName: file.name, purpose, by });
    return json(r.ok ? { ok: true, id: r.id, duplicateOf: r.duplicateOf } : r);
  }

  if (intent === "pdf_url") {
    const type = String(formData.get("type") ?? "");
    if (!allowDirectTypes.includes(type)) return json({ ok: false, error: FILE_MESSAGES.type });
    const r = await createUploadUrl({
      contentType: type,
      sizeBytes: Number(formData.get("size")),
      originalName: String(formData.get("name") ?? ""),
      purpose,
      by,
    });
    return json(r.ok ? { ok: true, uploadUrl: r.uploadUrl, ticket: r.ticket } : r);
  }

  if (intent === "pdf_register") {
    const r = await registerUploadedFile({ ticket: String(formData.get("ticket") ?? ""), purpose, by });
    return json(r.ok ? { ok: true, id: r.id, duplicateOf: r.duplicateOf } : r);
  }

  return json({ ok: false, error: FILE_MESSAGES.sendFailed }, 400);
};
