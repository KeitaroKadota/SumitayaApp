// 打刻のときに位置を1回だけ取る(ブラウザ側。E-01 01 5章、03 EV-02 手順2)。みるきーの TimeCardButtons.tsx の getPosition() を流用。
// 位置の確認を外すことになったら、ここで常に null を返す(src/utils/punchLocation.ts の先頭の説明)。
export type BrowserPosition = { latitude: number; longitude: number; accuracy: number };

// 高精度・最大8秒。取れなければ null(位置なしで送る)
export const getPosition = (): Promise<BrowserPosition | null> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
