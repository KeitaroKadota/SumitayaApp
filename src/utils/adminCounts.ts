// 管理画面の「確認が必要なこと」の件数(CMN-01 G05・EV-11。2026-11-25)。
// トップのカードと左メニューの件数の両方で使う。数え方は各機能の画面と同じ関数を呼ぶだけで、新しい集計は作らない。
// layout と page の両方から呼ばれるので、React の cache で1回の表示につき1回だけ数える。
import { cache } from "react";
import { countOpenInquiries } from "@/app/admin/inquiries/inquiryData";
import { ADMIN_COUNT_KEYS, type AdminMenuBadge } from "@/app/admin/adminMenu";
import { countAlerts } from "@/utils/attendanceServer";
import { countUnmatchedDeposits } from "@/utils/depositsServer";
import { countOpenExceptionOrders } from "@/utils/orders";
import { countPayablesByTab } from "@/utils/payablesServer";
import { canAccess, type FeatureKey, type Role } from "@/utils/permissions";
import { countReceiving } from "@/utils/receiving";

export type AdminCountKey = AdminMenuBadge;

// 数えた結果。キーが無い = その機能を使えない(数えない)。null = 数えられなかった
export type AdminCounts = Partial<Record<AdminCountKey, number | null>>;

const COUNTERS: Record<AdminCountKey, { feature: FeatureKey; label: string; count: () => Promise<number> }> = {
  inquiries_open: { feature: "inquiries", label: "対応中の問い合わせ", count: countOpenInquiries },
  exceptions_open: { feature: "orders", label: "例外注文", count: countOpenExceptionOrders },
  receiving_review: { feature: "purchasing", label: "確認が必要な納品書", count: async () => (await countReceiving()).review },
  payables_review: { feature: "payables", label: "確認待ちの請求書", count: async () => (await countPayablesByTab()).needs_review },
  deposits_unmatched: { feature: "receivables", label: "未消込の入金", count: countUnmatchedDeposits },
  attendance_alerts: { feature: "attendance_admin", label: "勤怠の異常", count: () => countAlerts({ status: "open" }) },
};

export const adminCountFeature = (key: AdminCountKey): FeatureKey => COUNTERS[key].feature;

// 区分の並びを文字列にしたものをキーにする(cache は引数の同一性で見分けるため、配列は渡さない)
const countsForRoles = cache(async (rolesKey: string): Promise<AdminCounts> => {
  const roles = rolesKey.split(",").filter(Boolean) as Role[];
  const keys = ADMIN_COUNT_KEYS.filter((key) => canAccess(roles, COUNTERS[key].feature));
  const results = await Promise.allSettled(keys.map((key) => COUNTERS[key].count()));
  const counts: AdminCounts = {};
  keys.forEach((key, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      counts[key] = r.value;
    } else {
      // 1つ数えられなくても、ほかは出す(EV-11 手順1-2)
      console.error(`${COUNTERS[key].label}を数えられませんでした:`, r.reason instanceof Error ? r.reason.message : r.reason);
      counts[key] = null;
    }
  });
  return counts;
});

export const getAdminCounts = (roles: readonly Role[]): Promise<AdminCounts> => countsForRoles([...roles].sort().join(","));
