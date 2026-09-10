// 가오픈 기준 기한 — **팀장까지 · 읽기 전용** (MD-P-2026-041 §C).
//
// 관리자 전용이 아니다. 기한을 조정하는 것은 팀장의 일이다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import OpenDueView from "@/components/OpenDueView";
import { hasLead } from "@/lib/types";
import { DENIED_HREF } from "@/lib/denied";

export const dynamic = "force-dynamic";

export default async function Page() {
  // 실시간 role 게이트 — 강등 즉시 반영 (토큰 role 이 아니라 DB 기준).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (!hasLead(live.user.role)) redirect(DENIED_HREF);
  return (
    <AppShell user={live.user}>
      <OpenDueView />
    </AppShell>
  );
}
