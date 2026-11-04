"use client";

// 一覧の絞り込みのチェック(押したらすぐ表示を変える)。検索のフォーム(method="get")の中に置く。
import { Checkbox } from "@/components/Checkbox";

export function AutoSubmitCheckbox({
  name,
  value = "1",
  label,
  defaultChecked,
}: {
  name: string;
  value?: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <Checkbox
      name={name}
      value={value}
      label={label}
      defaultChecked={defaultChecked}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  );
}
