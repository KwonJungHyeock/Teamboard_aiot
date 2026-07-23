import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import MemberManager from "@/components/MemberManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  // 실시간 role 게이트 — 강등 즉시 반영 (토큰 role이 아닌 DB 기준)
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (live.user.role !== "lead") redirect("/assistant");
  return (
    <AppShell user={live.user}>
      <MemberManager user={live.user} />
    </AppShell>
  );
}
