import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import MemberManager from "@/components/MemberManager";
import { isAdmin } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  // 실시간 role 게이트 — 강등 즉시 반영 (토큰 role이 아닌 DB 기준)
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  // **관리자 전용** (MD-P-2026-035 §B-3). 팀장은 못 들어온다 —
  // 계정 발급과 역할 변경이 여기 있고, 그 둘은 D-1 표에서 관리자만이다.
  if (!isAdmin(live.user.role)) redirect("/assistant");
  return (
    <AppShell user={live.user}>
      <MemberManager user={live.user} />
    </AppShell>
  );
}
