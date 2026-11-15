// C-01(納品書の読み取り)から呼ぶ、C-02(発注との照合・検収)の入口(C-01 03 EV-10 手順7・EV-11 手順3)。
// C-01 は変えなくてよいように、関数の形は C-02 を作る前のまま残し、中身を C-02 の処理(src/utils/receiving.ts)に置き換えた。
import { closeReceivingTasks, matchSlip } from "@/utils/receiving";

// C-02 EV-01: 確定した納品書を発注と照合する(一致すれば自動で検収する)。照合したら true、照合できない状態なら false
export const matchConfirmedSlip = async (slipId: string, by: string): Promise<boolean | null> => {
  const outcome = await matchSlip(slipId, { by, allowAuto: true });
  return outcome.ok;
};

// 確定を取り消したとき、C-02 が持つもの(確認を頼んだタスク)を片付ける。
// 照合の結果の列(delivery_slips.match_status など)は C-01 の確定の取消で空に戻す
export const clearSlipMatch = async (slipId: string, by: string): Promise<void> => {
  void by;
  await closeReceivingTasks(slipId, "納品書の確定を取り消した");
};
