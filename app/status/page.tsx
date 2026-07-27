// 업무 현황 (관리 전용) — 홈에서 이전한 팀 분석 차트. lead 실시간 게이트(강등 즉시 반영).
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { buildHomeSummary } from "@/lib/home";
import AppShell from "@/components/AppShell";
import StatusView from "@/components/StatusView";

export const dynamic = "force-dynamic";

export default async function Page() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (live.user.role !== "lead") redirect("/assistant");
  // 기존 홈 집계 재사용 — 팀 전체 관점(isLead=true)
  const summary = await buildHomeSummary(live.user.id, true);
  return (
    <AppShell user={live.user}>
      <StatusView weeklyDone={summary.weeklyDone} assigneeLoad={summary.assigneeLoad} />
    </AppShell>
  );
}
