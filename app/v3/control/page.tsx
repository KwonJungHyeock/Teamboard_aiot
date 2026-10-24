// 관제 — **열두 번째** 화면 · 첫 화면 (2026-10 관제 패널 · v2 안내판과 상태 벽).
// 스위치와 열둘은 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다.
// 값은 여기서(서버) 센다 — `lib/control.ts` 는 `pg` 를 끌고 와서 부품이 import 하지 않는다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { hasLead } from "@/lib/types";
import { TEAM_NAME } from "@/lib/brand";
import { getPlatformOpen } from "@/lib/platform-config";
import { dDay } from "@/lib/countdown";
import { getControl, QUIET_DAYS } from "@/lib/control";
import ControlView from "@/components/v3/ControlView";
import { getBrief, weekOf } from "@/lib/brief";
import "../../v3-control.css";

export const dynamic = "force-dynamic";

export default async function V3Control() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const [data, { openAt }, brief] = await Promise.all([getControl(live.user.id), getPlatformOpen(), getBrief(weekOf(-1).start)]);
  // 가오픈 날은 대시보드와 **같은 자리**(`platform-config`)에서, 같은 셈(`dDay`)으로 — 두 화면이 다른 날을 말하면 안 된다.
  const openAtMs = Date.parse(openAt);
  return (
    <ControlView {...data} brief={brief} meId={live.user.id} quietDays={QUIET_DAYS} canLead={hasLead(live.user.role)} team={TEAM_NAME}
                 openDay={Number.isFinite(openAtMs) ? dDay(openAtMs, Date.now()) : null}
                 openDate={Number.isFinite(openAtMs) ? new Date(openAtMs + 9 * 3600 * 1000).toISOString().slice(5, 10).replace("-", ".") : null} />
  );
}
