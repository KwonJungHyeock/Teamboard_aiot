// 관제 — **열두 번째** 화면 (2026-10 관제 패널).
// 스위치와 열둘은 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다.
// 값은 여기서(서버) 센다 — `lib/control.ts` 는 `pg` 를 끌고 와서 부품이 import 하지 않는다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { hasLead } from "@/lib/types";
import { TEAM_NAME } from "@/lib/brand";
import { getControl, QUIET_DAYS } from "@/lib/control";
import ControlView from "@/components/v3/ControlView";
import "../../v3-control.css";

export const dynamic = "force-dynamic";

export default async function V3Control() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const data = await getControl(live.user.id);
  return <ControlView {...data} quietDays={QUIET_DAYS} canLead={hasLead(live.user.role)} team={TEAM_NAME} />;
}
