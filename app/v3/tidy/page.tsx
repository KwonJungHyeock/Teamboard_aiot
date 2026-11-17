// 정리 필요함 (2026-11 모니터링) — 팀장 · 관리자만. 기한 없음 · 기타 · 목표 미연결 · 담당 없음 · 검토 오래를 바로 고친다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { hasLead } from "@/lib/types";
import { deniedHref } from "@/lib/denied";
import Tidy from "@/components/ed/screens/Tidy";
import "../../ed-person.css";

export const dynamic = "force-dynamic";

export default async function V3Tidy() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (!hasLead(live.user.role) && !live.user.adminGrant) redirect(deniedHref("stats"));
  return <Tidy />;
}
