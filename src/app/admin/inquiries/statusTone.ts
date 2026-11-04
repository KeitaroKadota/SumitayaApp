// 問い合わせの状態のバッジの色(一覧・詳細で共通)。状態の文字と一緒に出す(色だけにしない)
import type { BadgeTone } from "@/components/Badge";
import type { InquiryStatus } from "@/utils/inquiryRules";

export const STATUS_TONES: Record<InquiryStatus, BadgeTone> = {
  new: "danger",
  in_progress: "warning",
  waiting: "neutral",
  replied: "success",
  closed: "neutral",
  ignored: "neutral",
};
