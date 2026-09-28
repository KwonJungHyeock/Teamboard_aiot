// v3 「목표 상세」 (MD-P-2026-067 §B-8).
//
// 오늘 날짜는 **서버가 정해서 넘긴다** — 기한이 지났는지를 브라우저 시계로
// 판정하지 않는다(다른 v3 화면과 같은 규칙).
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { kstToday } from "@/lib/home";
import GoalDetailView from "@/components/v3/GoalDetailView";

export const dynamic = "force-dynamic";

export default async function V3GoalDetail({ params }: { params: { id: string } }) {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const id = Number(params.id);
  // 숫자가 아니면 목록으로. **없는 번호를 화면에 옮기지 않는다.**
  if (!Number.isInteger(id) || id <= 0) redirect("/v3/goals");
  return <GoalDetailView id={id} me={live.user.id} today={kstToday()} />;
}
