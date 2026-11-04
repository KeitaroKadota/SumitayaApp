"use client";

// G01 の打刻ボタン(E-01 03 EV-02)。今の状態で押せるボタンだけを出す(押せる種類はサーバーで決めて渡す)。
// みるきーの TimeCardButtons.tsx の作り(位置を取って送る、送信中は押せなくする)を流用し、結果は戻り値(useActionState)で出す。
import { startTransition, useActionState, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { PUNCH_KIND_LABELS, type PunchKind } from "@/utils/timecard";
import { punch, type PunchResult } from "./actions";
import { getPosition } from "./getPosition";

const NETWORK_ERROR: PunchResult = {
  tone: "error",
  message: "打刻できませんでした。電波のよい場所で、もう一度押してください。",
};

// 通信できなかったとき(サーバーの処理が例外で終わったとき)も、画面に文を出してボタンを戻す
const punchSafely = async (prev: PunchResult, formData: FormData): Promise<PunchResult> => {
  try {
    return await punch(prev, formData);
  } catch {
    return NETWORK_ERROR;
  }
};

export function PunchButtons({ kinds, reclockIn }: { kinds: PunchKind[]; reclockIn: boolean }) {
  const [result, dispatch, saving] = useActionState(punchSafely, null);
  const [locating, setLocating] = useState(false);
  const busy = locating || saving;

  const handlePunch = async (kind: PunchKind) => {
    // 手順1・2
    setLocating(true);
    const position = await getPosition();
    // 手順3
    const formData = new FormData();
    formData.set("kind", kind);
    formData.set("positionAvailable", position ? "1" : "0");
    if (position) {
      formData.set("latitude", String(position.latitude));
      formData.set("longitude", String(position.longitude));
      formData.set("accuracy", String(position.accuracy));
    }
    // 「記録中…」に切り替える(同じ更新の中で送信中にするので、ボタンが押せる状態に一瞬戻らない)
    startTransition(() => dispatch(formData));
    setLocating(false);
  };

  const label = (kind: PunchKind) => (kind === "clock_in" && reclockIn ? "出勤（再出勤）" : PUNCH_KIND_LABELS[kind]);

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid gap-3 ${kinds.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {kinds.map((kind) => (
          <Button
            key={kind}
            variant={kind === "break_start" || kind === "break_end" ? "secondary" : "primary"}
            size="lg"
            className="min-h-14 w-full"
            disabled={busy}
            onClick={() => void handlePunch(kind)}
          >
            {label(kind)}
          </Button>
        ))}
      </div>
      {busy && (
        <p className="text-sm text-ink-muted" aria-live="polite">
          {locating ? "位置を確認中…" : "記録中…"}
        </p>
      )}
      {!busy && result && <Alert tone={result.tone}>{result.message}</Alert>}
    </div>
  );
}
