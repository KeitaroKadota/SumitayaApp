// 打刻の位置の確認(E-01 01 5章、03 の 0.3、04 CH-05・CH-06・CH-07)。DBを読まない計算だけのファイル。
// 位置の確認は要件に無く、みるきーからの流用として残っている(00_要件外として外したもの.md の「判断が必要」)。
// 外すことになっても外しやすいよう、位置の扱いはこのファイル(サーバー側)と
// src/app/timecard/getPosition.ts(ブラウザ側で位置を取る処理)の2つにまとめた。
// 外すときは、getPosition.ts が常に null を返すようにし、judgeLocation が常に not_checked を返すようにすれば、
// 打刻の処理(actions.ts)と画面は直さずに済む(位置の列は空、判定は「判定なし」になる)。
import { LOCATION_REQUIRED } from "@/utils/attendanceRules";
import { distanceInMeters } from "@/utils/geo";
import { formatQuantity } from "@/utils/format";

export type LocationStatus = "in_range" | "out_of_range" | "unavailable" | "not_checked";
export type WorkLocationKind = "store" | "factory";

// ブラウザから届いた位置(CH-05 で確かめたあと)
export type PunchPosition = { latitude: number; longitude: number; accuracyM: number | null };

// 打刻場所(work_locations)
export type WorkLocation = {
  id: string;
  name: string;
  kind: WorkLocationKind;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  weeklyLegalMinutes: number;
};

export type LocationJudgement = { status: LocationStatus; locationId: string | null; distanceM: number | null };

// 画面とメッセージで使う短い名前(「店舗から850m」)
export const LOCATION_KIND_LABELS: Record<WorkLocationKind, string> = { store: "店舗", factory: "工場" };

// DBの integer に入る大きさまで(誤差がこれより大きい値はおかしな値として扱う)
const MAX_INT = 2147483647;

const toNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// CH-05 位置の値の範囲。満たさない、または数字でないときは「取れなかった」(null)として扱う
export const parsePosition = (input: {
  available: string | null;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
}): PunchPosition | null => {
  if (input.available !== "1") return null;
  const latitude = toNumber(input.latitude);
  const longitude = toNumber(input.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  let accuracyM: number | null = null;
  if (input.accuracy !== null && input.accuracy.trim() !== "") {
    const accuracy = toNumber(input.accuracy);
    if (accuracy === null || accuracy < 0 || accuracy > MAX_INT) return null;
    accuracyM = Math.round(accuracy);
  }
  return { latitude, longitude, accuracyM };
};

// CH-07 位置が必須の決まり(定数 LOCATION_REQUIRED)で、位置が取れなかったか
export const isPositionMissingButRequired = (position: PunchPosition | null): boolean => LOCATION_REQUIRED && !position;

// 03 の 0.3 打刻場所の判定(CH-06)。誤差(accuracyM)は記録するが判定には使わない
export const judgeLocation = (position: PunchPosition | null, locations: WorkLocation[]): LocationJudgement => {
  // 手順1
  if (!position) return { status: "unavailable", locationId: null, distanceM: null };
  // 手順2: 緯度・経度が登録済みの場所だけを使う(locations は有効な場所だけを渡す)
  const registered = locations.filter((l) => l.latitude !== null && l.longitude !== null);
  if (registered.length === 0) return { status: "not_checked", locationId: null, distanceM: null };
  // 手順3: いちばん近い場所
  let nearest = registered[0];
  let nearestDistance = Infinity;
  for (const location of registered) {
    const d = distanceInMeters(position.latitude, position.longitude, location.latitude!, location.longitude!);
    if (d < nearestDistance) {
      nearest = location;
      nearestDistance = d;
    }
  }
  // 手順4・5
  return {
    status: nearestDistance <= nearest.radiusM ? "in_range" : "out_of_range",
    locationId: nearest.id,
    distanceM: Math.round(nearestDistance),
  };
};

const placeOf = (kind: WorkLocationKind | null) => (kind ? LOCATION_KIND_LABELS[kind] : "打刻場所");

// 打刻の一覧に出す場所(02 の G01)。範囲内は場所の名前、範囲外・位置なしは「⚠」の文字。判定なしは出さない(null)
export const locationLabel = (punch: {
  locationStatus: LocationStatus;
  locationKind: WorkLocationKind | null;
  distanceM: number | null;
}): string | null => {
  switch (punch.locationStatus) {
    case "in_range":
      return placeOf(punch.locationKind);
    case "out_of_range":
      return `⚠範囲外（${placeOf(punch.locationKind)}から${formatQuantity(punch.distanceM ?? 0, "m")}）`;
    case "unavailable":
      return "⚠位置情報なし";
    default:
      return null;
  }
};

// 打刻の結果のメッセージに足す注意(03 の EV-03 の「返すメッセージ」)。注意が無ければ null
export const locationNotice = (judgement: LocationJudgement, locationKind: WorkLocationKind | null): string | null => {
  if (judgement.status === "out_of_range") {
    return `店舗・工場から離れた場所での打刻です（${placeOf(locationKind)}から${formatQuantity(judgement.distanceM ?? 0, "m")}）。管理者が確認します。`;
  }
  if (judgement.status === "unavailable") return "位置情報が取れなかったため、管理者が確認します。";
  return null;
};

// CH-07 で打刻させないときの文(EV-03 手順4)
export const POSITION_REQUIRED_MESSAGE =
  "位置情報が取得できないため打刻できません。スマホの設定で位置情報の利用を許可してください。";
