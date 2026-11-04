// 返品の画面(D-06 G01〜G03)で共通に使う表示の値。状態の文字と一緒に出す(色だけにしない)
import type { BadgeTone } from "@/components/Badge";
import type { ReturnStatus } from "@/utils/returnRules";

export const RETURN_STATUS_TONES: Record<ReturnStatus, BadgeTone> = {
  waiting_item: "warning",
  item_arrived: "neutral",
  rejected: "danger",
  cancelled: "neutral",
};
