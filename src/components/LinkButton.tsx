import Link from "next/link";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "@/components/Button";

// 画面を移るだけのボタン(00_画面共通ルール 4章。みるきーの BackButton.tsx の役割)。
export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "md",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClassName(variant, size, className)}>
      {children}
    </Link>
  );
}

// 「← ホームへ」「← 一覧へ」の形の戻るリンク(文字のリンク)
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-sm font-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      ← {label}
    </Link>
  );
}
