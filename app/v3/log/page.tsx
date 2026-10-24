// 업무일지 — 하루 한 줄 기록 + 월 히트맵 (디자인 v1.0 · my-log.dc.html).
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import LogView from "@/components/ed/screens/LogView";
import "../../ed-log.css";

export const dynamic = "force-dynamic";

export default async function V3Log() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <LogView meId={live.user.id} />;
}
