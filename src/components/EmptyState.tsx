// 空の状態(00_画面共通ルール 4章)。一覧が0件のとき「〜はまだありません。」と、次にできる操作を出す。

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface p-6 text-sm text-ink-muted">
      <p>{message}</p>
      {action}
    </div>
  );
}
