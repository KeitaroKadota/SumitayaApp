"use client";

// 確認付きの送信ボタン(00_画面共通ルール 4章の ConfirmForm の役割)。元に戻しにくい操作に使う。
// 押すと確認のダイアログを出し、「キャンセル」なら送信しない。フォームの中に置く。
import { useFormStatus } from "react-dom";
import { buttonClassName, type ButtonVariant } from "@/components/Button";

export function ConfirmSubmitButton({
  children,
  confirmMessage,
  pendingText = "送信中…",
  variant = "danger",
  className = "",
  disabled = false,
  form,
  name,
  value,
}: {
  children: React.ReactNode;
  confirmMessage: string;
  pendingText?: string;
  variant?: ButtonVariant;
  className?: string;
  disabled?: boolean;
  // フォームの外に置くときに、送るフォームの id を渡す
  form?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      form={form}
      name={name}
      value={value}
      disabled={pending || disabled}
      className={buttonClassName(variant, "md", className)}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
