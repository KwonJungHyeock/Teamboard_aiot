// 목표 관리 — 디자인 v1.0 (goals.dc.html). 옛 목표 상세(`/v3/goals/[id]`)는 `?g=ID` 로 넘어온다.
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getLiveSession } from "@/lib/auth";
import Goals from "@/components/ed/screens/Goals";
import "../../ed-goals.css";

export const dynamic = "force-dynamic";

export default async function V3Goals() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <Suspense fallback={null}><Goals /></Suspense>;
}
