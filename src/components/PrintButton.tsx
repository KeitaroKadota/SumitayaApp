"use client";

// 印刷のボタン(00_画面共通ルール 4章・9章)。ブラウザの印刷を開く。印刷した紙には出さない(print:hidden)。
import { Button } from "@/components/Button";

export function PrintButton({ label = "印刷する" }: { label?: string }) {
  return (
    <Button variant="primary" className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
