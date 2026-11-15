// C-01 G02 納品書のページの送り先(03 EV-01・EV-02・EV-02B)。
// 画像は端末で縮小したものをここで受け取って保存し、PDF は署名付きのアップロード用URLを出して、直接送ったあとに記録する。
// 中身は共通の handleFileUpload(src/utils/storageUpload.ts)。先頭で requireAccess を呼ぶ(URL を出す前の権限の確認も含む)。
import { requireAccess } from "@/utils/auth";
import { CAPTURE_URL } from "@/utils/deliverySlipServer";
import { handleFileUpload } from "@/utils/storageUpload";

export async function POST(request: Request) {
  const me = await requireAccess("purchasing", CAPTURE_URL);
  // 1ページずつ送る(1件に5ページまでは CH-04 で確かめる)。直接送るのは PDF だけ
  return handleFileUpload(request, { purpose: "delivery_slip", by: me.id, allowDirectTypes: ["application/pdf"] });
}
