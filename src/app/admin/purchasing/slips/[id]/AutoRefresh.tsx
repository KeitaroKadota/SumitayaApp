"use client";

// C-01 G03 「読み取り中…」のあいだ、数秒ごとに画面を新しくする(03 EV-07 手順5)。
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_MS = 5000;

export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
