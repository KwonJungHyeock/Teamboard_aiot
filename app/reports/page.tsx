import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ReportsView from "@/components/ReportsView";

export const dynamic = "force-dynamic";

export default async function Page() {
  // 실시간 role 게이트 — 강등 즉시 반영.
  // 성과 리포트(MD-P-2026-010)는 전원 조회 가능하므로 lead 리다이렉트를 걷어냈다.
  // 팀장 전용인 "승인 보고서" 탭만 화면 안에서 가린다.
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return (
    <AppShell user={live.user}>
      <ReportsView user={live.user} notionConnected={!!process.env.NOTION_TOKEN} />
    </AppShell>
  );
}
