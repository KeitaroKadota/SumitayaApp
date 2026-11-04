// E-04 G02 請求書のファイルの送り先(03 EV-03 手順1、C-01 03 EV-01・EV-02B)。
// 画像は端末で縮小したものをここで受け取って保存し、PDF は署名付きのアップロード用URLを出して、直接送ったあとに記録する。
// 中身は共通の handleFileUpload(src/utils/storageUpload.ts)。先頭で requireAccess を呼ぶ(URL を出す前の権限の確認も含む)。
import { requireAccess } from "@/utils/auth";
import { handleFileUpload } from "@/utils/storageUpload";

export async function POST(request: Request) {
  const me = await requireAccess("payables", "/admin/payables/new");
  // 1件に1ファイル(画像1枚かPDF1つ。E-04 CH-02)。直接送るのは PDF だけ
  return handleFileUpload(request, { purpose: "received_invoice", by: me.id, allowDirectTypes: ["application/pdf"] });
}
