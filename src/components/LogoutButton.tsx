import { logout } from "@/app/logout/actions";
import { SubmitButton } from "@/components/SubmitButton";

// ログアウト(EV-03)。G04 ホーム・G05 管理画面に置く
export function LogoutButton({ className = "" }: { className?: string }) {
  return (
    <form action={logout} className={className}>
      <SubmitButton variant="secondary" pendingText="ログアウト中…" className="w-full">
        ログアウト
      </SubmitButton>
    </form>
  );
}
