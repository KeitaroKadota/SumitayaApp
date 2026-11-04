// E-07 G02 領収書の画像の送り先(03 EV-02 手順1〜3・EV-05、04 CH-03、C-01 03 EV-01)。
// 端末で長い辺2,000pxに縮小した画像をここで受け取って保存する(4MBまで。PDF・直接の送り方は使わない)。
// 中身は共通の handleFileUpload(src/utils/storageUpload.ts)。先頭で requireAccess を呼ぶ。
import { requireAccess } from "@/utils/auth";
import { handleFileUpload } from "@/utils/storageUpload";

export async function POST(request: Request) {
  const me = await requireAccess("expenses_apply", "/expenses/new");
  // 1件に画像1枚(CH-03)
  return handleFileUpload(request, { purpose: "receipt", by: me.id, allowDirectTypes: [] });
}
