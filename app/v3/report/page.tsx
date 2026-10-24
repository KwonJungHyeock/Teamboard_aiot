// 월간 보고(개인 · 0042) — 디자인 v1.0 (monthly-report.dc.html). 내 보고 쓰기 · 내기, 팀장은 「팀원 보고」 탭.
// 알림함에서 오면 `?r=보고번호` — 그 보고의 달 · 탭으로 연다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { hasLead } from "@/lib/types";
import { kstToday } from "@/lib/home";
import ReportView from "@/components/ed/screens/ReportView";
import "../../ed-log.css";
import "../../ed-report.css";

export const dynamic = "force-dynamic";

export default async function V3Report({ searchParams }: { searchParams: { m?: string; tab?: string; r?: string } }) {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const lead = hasLead(live.user.role) || live.user.adminGrant;
  let month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.m ?? "") ? searchParams.m! : kstToday().slice(0, 7);
  let tab: "mine" | "team" = searchParams.tab === "team" && lead ? "team" : "mine";
  const rid = Number(searchParams.r);
  if (Number.isInteger(rid) && rid > 0) {
    const r = await queryOne<{ month: string; actor_id: number }>(`SELECT month, actor_id FROM monthly_report WHERE id = $1`, [rid]);
    if (r) { month = r.month; tab = r.actor_id === live.user.id ? "mine" : lead ? "team" : "mine"; }
  }
  return <ReportView key={`${month}:${tab}`} lead={lead} initMonth={month} initTab={tab} />;
}
