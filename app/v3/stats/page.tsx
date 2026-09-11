// v3 「집계」 (MD-P-2026-052 §B).
//
// ── 누가 보는가 ──────────────────────────────────────────────────
//
// **팀장까지**다(`hasLead`). 관리자 전용이 아니다 — 팀의 숫자를 보는 것은
// 팀장의 일이다. 레일도 **같은 함수**로 가린다: 링크의 조건과 화면의 조건이
// 두 벌이 되면 보이는데 안 되는 자리가 생긴다 (§G 038).
//
// 서버가 정해서 넘기는 것 셋 — 오늘 날짜(KST) · 카테고리 · 담당자.
// 데이터는 화면이 `/api/tasks` 와 `/api/tasks/open-due` 에서 가져온다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { query } from "@/lib/db";
import { kstToday } from "@/lib/home";
import { hasLead } from "@/lib/types";
import { deniedHref } from "@/lib/denied";
import { resolveAreas } from "@/lib/v3/category";
import StatsView from "@/components/v3/StatsView";

export const dynamic = "force-dynamic";

export default async function V3Stats() {
  // 스위치는 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다 (§G).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  // 등급은 여기서 막는다. 「막은 사람이 가는 곳도 한 곳에서 낸다」(§G) — DENIED_HREF.
  if (!hasLead(live.user.role)) redirect(deniedHref("stats"));

  const [areaRows, people] = await Promise.all([
    query<{ id: number; name: string }>(
      `SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`
    ),
    query<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM actor
        WHERE type = 'human' AND is_active = true ORDER BY id`
    ),
  ]);

  // `useSearchParams` 는 Suspense 경계를 요구한다 — 보고 있는 달이 주소에 담긴다.
  return (
    <Suspense fallback={<p className="v3-loading">불러오는 중…</p>}>
      <StatsView
        today={kstToday()}
        areas={resolveAreas(areaRows)}
        people={people.map((p) => ({ id: p.id, name: p.display_name }))}
      />
    </Suspense>
  );
}
