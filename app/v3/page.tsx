// v3 「오늘」 (MD-P-2026-043 §C-1).
//
// 서버가 정해서 넘기는 것 셋:
//   · **오늘 날짜(KST)** — 브라우저 시계를 안 믿는다. 시계가 틀린 기계에서
//     「오늘 할 일」이 통째로 달라지면 그건 화면 탓이 아니라 우리 탓이다.
//   · **가오픈 D** — 대문 카운트다운과 **같은 함수**(`lib/countdown.ts` 의 `dDay`).
//     두 자리가 다른 숫자를 내면 안 된다.
//   · **카테고리 색** — `area` 를 읽어 id → 색으로 풀어서 넘긴다.
//     화면은 이름을 보고 색을 정하지 않는다(§G).
//
// 데이터 자체는 화면이 **기존 엔드포인트**에서 가져온다. 새 API 는 없다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { kstToday } from "@/lib/home";
import { getPlatformOpen } from "@/lib/platform-config";
import { dDay } from "@/lib/countdown";
import { resolveAreas } from "@/lib/v3/category";
import TodayView from "@/components/v3/TodayView";

export const dynamic = "force-dynamic";

export default async function V3Today() {
  // 스위치는 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다 (§G — 막는 것은
  // 뿌리에서 한 번). 여기서 또 막지 않는다.
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");

  const [{ openAt }, areaRows] = await Promise.all([
    getPlatformOpen(),
    query<{ id: number; name: string }>(
      `SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`
    ),
  ]);
  const openAtMs = Date.parse(openAt);
  const today = kstToday();

  return (
    <TodayView
      name={live.user.name}
      today={today}
      openAtMs={openAtMs}
      dday={dDay(openAtMs, Date.now())}
      areas={resolveAreas(areaRows)}
    />
  );
}
