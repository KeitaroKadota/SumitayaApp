// EV-13 テスト送信(G06 の本人、CMN-02 の G03 の社長)。結果を画面のお知らせ欄の値にして返す。
// 権限チェックは呼ぶ側の操作で済ませること。
import { getLineLinkStatus } from "@/utils/lineAccount";
import { TEST_MESSAGE, notifyEmployees } from "@/utils/notify";

export type LineTestResult = "sent" | "disabled" | "not_linked" | "skipped" | "failed";

export const sendLineTest = async (employeeId: string): Promise<LineTestResult> => {
  // 手順2: 連携済みか
  const status = await getLineLinkStatus(employeeId);
  if (!status?.linked) return "not_linked";
  // 手順3: 送信オフでも記録には残る
  try {
    const result = await notifyEmployees([employeeId], TEST_MESSAGE, { kind: "test" });
    const outcome = result.outcomes[0];
    if (!outcome || outcome.status === "failed") return "failed";
    if (outcome.status === "sent") return "sent";
    return outcome.skipReason === "disabled" ? "disabled" : outcome.skipReason === "not_linked" ? "not_linked" : "skipped";
  } catch (e) {
    console.error("テストのメッセージを送れませんでした:", e instanceof Error ? e.message : e);
    return "failed";
  }
};

// 手順4: 結果の文(お知らせ欄)
export const LINE_TEST_MESSAGES: Record<LineTestResult, { tone: "success" | "warning" | "error"; text: string }> = {
  sent: {
    tone: "success",
    text: "テストのメッセージを送りました。届かない場合は、公式アカウントを友だちに追加しているか確かめてください。",
  },
  disabled: { tone: "warning", text: "LINEの送信がオフになっているため、送っていません（記録だけ残しました）。" },
  not_linked: { tone: "warning", text: "LINE通知が未設定です。" },
  skipped: { tone: "warning", text: "送れる状態ではないため、送っていません（退職・1日の上限など）。" },
  failed: { tone: "error", text: "送れませんでした。記録をご確認ください。" },
};

export const isLineTestResult = (value: unknown): value is LineTestResult =>
  typeof value === "string" && Object.hasOwn(LINE_TEST_MESSAGES, value);
