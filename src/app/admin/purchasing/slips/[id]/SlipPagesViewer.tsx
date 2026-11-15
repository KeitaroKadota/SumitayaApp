"use client";

// C-01 G03 納品書の画像(02 G03「画像」)。期限付きのURL(10分)で出す。ページを切り替え、画像は拡大・回転できる
// (画面の中だけ。保存はしない)。PDF はブラウザの表示に任せる。E-04 の FileViewer と同じ作りにページの切り替えを足した。
import { useState } from "react";
import { Button } from "@/components/Button";

export type SlipPage = { id: string; url: string | null; contentType: string; name: string };

export function SlipPagesViewer({ pages }: { pages: SlipPage[] }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const page = pages[Math.min(index, pages.length - 1)];

  if (!page) {
    return <p className="rounded-md border border-line bg-canvas p-4 text-sm text-ink-muted">画像はありません。</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {pages.length > 1 &&
          pages.map((p, i) => (
            <Button
              key={p.id}
              variant={i === index ? "primary" : "secondary"}
              onClick={() => {
                setIndex(i);
                setZoom(1);
                setRotate(0);
              }}
              aria-label={`${i + 1}ページ目を見る`}
            >
              {i + 1}
            </Button>
          ))}
        {pages.length > 1 && <span className="text-sm text-ink-muted">ページ</span>}
        {page.url && page.contentType !== "application/pdf" && (
          <>
            <Button variant="secondary" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="拡大する">
              拡大
            </Button>
            <Button variant="secondary" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="縮小する">
              縮小
            </Button>
            <Button variant="secondary" onClick={() => setRotate((r) => (r + 90) % 360)} aria-label="右に回す">
              回転
            </Button>
          </>
        )}
      </div>
      {!page.url ? (
        <div className="flex h-64 items-center justify-center rounded-md border border-line bg-canvas text-sm text-ink-muted">
          表示できません
        </div>
      ) : page.contentType === "application/pdf" ? (
        <div className="flex flex-col gap-2">
          <iframe src={page.url} title={page.name} className="h-[70vh] w-full rounded-md border border-line bg-surface" />
          <a href={page.url} target="_blank" rel="noreferrer" className="text-sm font-bold text-primary hover:underline">
            別のタブで開く
          </a>
        </div>
      ) : (
        <div className="h-[70vh] overflow-auto rounded-md border border-line bg-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.url}
            alt={`納品書の画像（${index + 1}ページ目）`}
            style={{ transform: `rotate(${rotate}deg)`, width: `${zoom * 100}%`, transformOrigin: "center" }}
            className="max-w-none transition-transform"
          />
        </div>
      )}
    </div>
  );
}
