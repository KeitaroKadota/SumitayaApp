"use client";

// E-04 G03 請求書の画像・PDFの表示(02 G03「請求書の画像」)。期限付きのURL(10分)で出す。画像は拡大・回転できる。
// PDF はブラウザの表示に任せる。
import { useState } from "react";
import { Button } from "@/components/Button";

export function FileViewer({ url, contentType, name }: { url: string | null; contentType: string | null; name: string | null }) {
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);

  if (!url) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-line bg-canvas text-sm text-ink-muted">
        表示できません
      </div>
    );
  }
  if (contentType === "application/pdf") {
    return (
      <div className="flex flex-col gap-2">
        <iframe src={url} title={name ?? "請求書のPDF"} className="h-[70vh] w-full rounded-md border border-line bg-surface" />
        <a href={url} target="_blank" rel="noreferrer" className="text-sm font-bold text-primary hover:underline">
          別のタブで開く
        </a>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="拡大する">
          拡大
        </Button>
        <Button variant="secondary" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="縮小する">
          縮小
        </Button>
        <Button variant="secondary" onClick={() => setRotate((r) => (r + 90) % 360)} aria-label="右に回す">
          回転
        </Button>
      </div>
      <div className="h-[70vh] overflow-auto rounded-md border border-line bg-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name ?? "請求書の画像"}
          style={{ transform: `rotate(${rotate}deg)`, width: `${zoom * 100}%`, transformOrigin: "center" }}
          className="max-w-none transition-transform"
        />
      </div>
    </div>
  );
}
