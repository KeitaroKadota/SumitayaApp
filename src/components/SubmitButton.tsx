"use client";

import { useFormStatus } from "react-dom";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "@/components/Button";

// フォーム送信用の共通ボタン(みるきーの SubmitButton.tsx の作りを流用)。
// 送信中は「〜中…」に変わって押せなくなり、二重送信を防ぐ。
export function SubmitButton({
  children,
  pendingText = "送信中…",
  variant = "primary",
  size = "md",
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending || disabled} className={buttonClassName(variant, size, className)}>
      {pending ? pendingText : children}
    </button>
  );
}
