// v3 「업무」 (MD-P-2026-044 §B).
//
// 서버가 정해서 넘기는 것 둘 — 「오늘」과 같은 이유다.
//   · **오늘 날짜(KST)** — 기한이 지났는지를 브라우저 시계로 판정하지 않는다
//   · **카테고리 색** — `area` 를 읽어 id → 색으로 풀어서 넘긴다
//
// 데이터는 화면이 `/api/tasks` 에서 가져온다. 새 API 는 없다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { query } from "@/lib/db";
import { kstToday } from "@/lib/home";
import { resolveAreas } from "@/lib/v3/category";
import TasksView from "@/components/v3/TasksView";

export const dynamic = "force-dynamic";

export default async function V3Tasks() {
  // 스위치는 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다 (§G).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");

  const areaRows = await query<{ id: number; name: string }>(
    `SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`
  );

  // `useSearchParams` 는 Suspense 경계를 요구한다 — 정렬·카테고리가 주소에 담기므로.
  return (
    <Suspense fallback={<p className="v3-loading">불러오는 중…</p>}>
      <TasksView today={kstToday()} areas={resolveAreas(areaRows)} />
    </Suspense>
  );
}
