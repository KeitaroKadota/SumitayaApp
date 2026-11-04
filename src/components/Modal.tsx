"use client";

// モーダル(00_画面共通ルール 4章・10章)。PC で一覧から詳細・編集を開くときに使う。
// URL の検索条件(例 ?edit=…)で開く形にし、閉じる(「閉じる」・Esc・外側を押す)と closeHref へ移る。
// 中身はサーバーの部品をそのまま children で渡せる。
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";

export function Modal({
  title,
  closeHref,
  children,
  size = "lg",
}: {
  title: string;
  closeHref: string;
  children: React.ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => router.push(closeHref, { scroll: false });

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // Esc で閉じたとき(cancel)も URL を戻す
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      className={`m-auto max-h-[90vh] w-full ${size === "lg" ? "max-w-3xl" : "max-w-md"} overflow-y-auto rounded-lg border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/40`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold break-words">{title}</h2>
          <Button variant="secondary" onClick={close}>
            閉じる
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
