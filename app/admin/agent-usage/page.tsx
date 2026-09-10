// 에이전트 흔적 집계 화면 — **관리자 전용 · 읽기 전용** (MD-P-2026-038 §B-1).
//
// 철거 전에 세어 두는 자리다. 지우는 버튼은 없다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AgentUsage from "@/components/AgentUsage";
import { isAdmin } from "@/lib/types";
import { DENIED_HREF } from "@/lib/denied";

export const dynamic = "force-dynamic";

export default async function Page() {
  // 실시간 role 게이트 — 강등 즉시 반영 (토큰 role 이 아니라 DB 기준).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (!isAdmin(live.user)) redirect(DENIED_HREF);
  return (
    <AppShell user={live.user}>
      <AgentUsage />
    </AppShell>
  );
}
