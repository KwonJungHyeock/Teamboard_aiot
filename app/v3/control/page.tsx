// 업무 현황 (디자인 v1.0 · DESIGN.md 5.2) — 팀 상태 관제와 내 업무 처리를 한 화면에서.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import Monitor from "@/components/ed/screens/Monitor";
import "../../ed-control.css";

export const dynamic = "force-dynamic";

export default async function V3Control() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <Monitor />;
}
