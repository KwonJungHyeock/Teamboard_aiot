// 전체 업무 — 디자인 v1.0 (tasks.dc.html). 데이터는 화면이 `/api/tasks` 에서 읽는다.
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getLiveSession } from "@/lib/auth";
import Tasks from "@/components/ed/screens/Tasks";
import "../../ed-tasks.css";

export const dynamic = "force-dynamic";

export default async function V3Tasks() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <Suspense fallback={null}><Tasks /></Suspense>;
}
