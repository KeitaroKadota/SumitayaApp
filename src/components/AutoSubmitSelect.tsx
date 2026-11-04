"use client";

// 一覧の絞り込みの選択(選んだらすぐ表示を変える)。検索のフォーム(method="get")の中に置く。
import { Select } from "@/components/Select";

export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
