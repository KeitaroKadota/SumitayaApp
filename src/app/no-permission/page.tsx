import { fullName, requireLogin } from "@/utils/auth";
import { LinkButton } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";

// G06 権限がありません(EV-12)。Next.js の forbidden() は試験段階の機能なので使わず、この画面へ移す
export default async function NoPermissionPage() {
  const me = await requireLogin("/");

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <h1 className="text-xl font-bold">この画面を使う権限がありません。</h1>
        <p>必要な場合は社長にお伝えください。</p>
        <LinkButton href="/" variant="primary" size="lg" className="w-full">
          ホームへ
        </LinkButton>
      </main>
    </>
  );
}
