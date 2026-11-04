// E-04 の画面で使う表示の決まり(02 G01・G03 の Badge の色)。DBを読まない。
import type { BadgeTone } from "@/components/Badge";
import type { LineMatchStatus, MatchResult, PayableStatus } from "@/utils/payables";

// 状態: 確認待ち＝warning、支払予定＝neutral、取消＝neutral(取り消し線は画面で付ける)
export const STATUS_TONES: Record<PayableStatus, BadgeTone> = {
  reading: "warning",
  needs_review: "warning",
  scheduled: "neutral",
  cancelled: "neutral",
};

// 突合: 一致＝success、差異あり＝danger、データなし＝warning、対象外＝neutral
export const MATCH_TONES: Record<MatchResult, BadgeTone> = {
  matched: "success",
  difference: "danger",
  no_data: "warning",
  not_applicable: "neutral",
};

export const LINE_MATCH_TONES: Record<LineMatchStatus, BadgeTone> = {
  matched: "success",
  amount_diff: "danger",
  price_diff: "danger",
  not_found: "warning",
  manual_ok: "neutral",
  not_applicable: "neutral",
};

export const LIST_URL = "/admin/payables";
export const SCHEDULE_URL = "/admin/payables/schedule";
