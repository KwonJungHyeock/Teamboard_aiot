// 일정 — 달/주 달력 + 날짜 패널 (디자인 v1.0 · calendar.dc.html, DESIGN.md 5.9)
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { getPlatformOpen } from "@/lib/platform-config";
import { openDay } from "@/lib/v3/calendar";
import Calendar from "@/components/ed/screens/Calendar";
import "../../ed-calendar.css";

export const dynamic = "force-dynamic";

export default async function V3Calendar() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const { openAt } = await getPlatformOpen();
  const ms = Date.parse(openAt);
  return <Calendar meId={live.user.id} launch={Number.isFinite(ms) ? openDay(ms) : null} />;
}
