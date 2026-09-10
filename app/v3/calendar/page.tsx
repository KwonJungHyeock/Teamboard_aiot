// v3 「캘린더」 (MD-P-2026-046 §C).
//
// 서버가 정해서 넘기는 것 셋 — 앞의 화면들과 같은 이유다.
//   · **오늘 날짜(KST)** — 「오늘」 칸을 브라우저 시계로 정하지 않는다.
//     시계가 하루 어긋난 기계에서 파란 동그라미가 엉뚱한 칸에 뜬다
//   · **가오픈 시각** — 강조할 칸을 `lib/v3/calendar.ts` 가 **같은 계산**으로 뽑는다
//   · **카테고리 색** — `area` 를 읽어 id → 색으로 풀어서 넘긴다
//
// 데이터는 화면이 `/api/tasks` 와 `/api/tasks/open-due` 에서 가져온다.
// 새 API 는 없다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { query } from "@/lib/db";
import { kstToday } from "@/lib/home";
import { getPlatformOpen } from "@/lib/platform-config";
import { resolveAreas } from "@/lib/v3/category";
import CalendarView from "@/components/v3/CalendarView";

export const dynamic = "force-dynamic";

export default async function V3Calendar() {
  // 스위치는 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다 (§G).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");

  const [{ openAt }, areaRows] = await Promise.all([
    getPlatformOpen(),
    query<{ id: number; name: string }>(
      `SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`
    ),
  ]);

  // `useSearchParams` 는 Suspense 경계를 요구한다 — 보고 있는 달이 주소에 담긴다.
  return (
    <Suspense fallback={<p className="v3-loading">불러오는 중…</p>}>
      <CalendarView
        today={kstToday()}
        openAtMs={Date.parse(openAt)}
        areas={resolveAreas(areaRows)}
      />
    </Suspense>
  );
}
