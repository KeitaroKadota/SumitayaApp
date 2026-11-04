import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// 書体は Noto Sans JP(00_画面共通ルール 3.1)
const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"], // 先読みは英数字だけ。日本語は使う文字の分だけ後から読み込まれる
  weight: ["400", "700"], // 普通・太字の2種類に絞る
  display: "swap",
  variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
  title: "祭すみたや 業務システム",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${notoSansJp.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
