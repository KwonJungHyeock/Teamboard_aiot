// 성과 분석 (디자인 v1.0 · stats.dc.html) — 팀장 · 관리자만. 숫자는 `/api/ed/stats` 가 센다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { kstToday } from "@/lib/home";
import { hasLead } from "@/lib/types";
import { deniedHref } from "@/lib/denied";
import Stats from "@/components/ed/screens/Stats";
import "../../ed-stats.css";

export const dynamic = "force-dynamic";

export default async function V3Stats() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (!hasLead(live.user.role) && !live.user.adminGrant) redirect(deniedHref("stats"));
  return <Stats initialMonth={kstToday().slice(0, 7)} />;
}
