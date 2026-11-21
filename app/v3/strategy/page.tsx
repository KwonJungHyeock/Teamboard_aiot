// 운영 전략 (지시서 v1): 축 4 × 단계 2 표 · 상세 패널 · 잠금 · 승인. 누구나 보고, 뷰어는 보기만.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import Strategy from "@/components/ed/screens/Strategy";
import "../../ed-strategy.css";

export const dynamic = "force-dynamic";

export default async function V3Strategy() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <Strategy />;
}
