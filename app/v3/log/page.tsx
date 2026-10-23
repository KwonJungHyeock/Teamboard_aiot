// 내 기록 — **열한 번째** 화면 (2026-10 업무기록 · 0037).
// 스위치와 열한은 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import WorklogView from "@/components/v3/WorklogView";
import "../../v3-log.css";

export const dynamic = "force-dynamic";

export default async function V3Log() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <WorklogView me={{ id: live.user.id, name: live.user.name }} />;
}
