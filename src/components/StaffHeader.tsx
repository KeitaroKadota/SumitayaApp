import Link from "next/link";

// スマホ向け画面の上の帯(00_画面共通ルール 5.1)。白地で、下に朱の細線(2px)。全画面で同じ。
export function StaffHeader({ name }: { name?: string }) {
  return (
    <header className="border-b-2 border-accent bg-surface">
      <div className="mx-auto flex min-h-12 w-full max-w-md items-center justify-between gap-2 px-4">
        <Link href="/" className="font-bold text-ink">
          祭すみたや
        </Link>
        {name && <span className="truncate text-sm text-ink-muted">{name}</span>}
      </div>
    </header>
  );
}
