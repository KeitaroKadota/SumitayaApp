// AIの案の表示(00_画面共通ルール 4章・7章)。AI(Gemini)が作った内容はすべてこれで囲む。
// 見出しに AiBadge・作った日時・「内容を確認・修正してから使ってください。」を必ず出す。
import { formatDateTime } from "@/utils/format";

export function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ai-soft px-2 py-0.5 text-xs font-bold text-ai">
      <span aria-hidden="true">✦</span>AIの案
    </span>
  );
}

export function AiDraft({
  title,
  createdAt,
  children,
  actions,
}: {
  title: string;
  createdAt: Date | string | null;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border-l-4 border-ai bg-ai-soft p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AiBadge />
        <span className="font-bold">
          {title}
          {createdAt ? `（${formatDateTime(createdAt)} 作成）` : ""}
        </span>
      </div>
      <p className="text-sm text-ink-muted">内容を確認・修正してから使ってください。</p>
      <div className="min-w-0">{children}</div>
      {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
    </section>
  );
}
