// v3 「상세」 (MD-P-2026-046 §B).
//
// 서버가 정해서 넘기는 것 넷 — 앞의 화면들과 같은 이유다.
//   · **오늘 날짜(KST)** — 기한이 지났는지를 브라우저 시계로 판정하지 않는다
//   · **가오픈 시각** — 기한 옆 표기를 대문 카운트다운과 **같은 계산**으로 낸다
//   · **카테고리 색** — `area` 를 읽어 id → 색으로 풀어서 넘긴다
//   · **담당 후보** — `actor(type='human')`. 화면은 이름만 그린다
//
// 업무 자체는 화면이 `GET /api/tasks/{id}` 에서 가져온다. 새 API 는 없다.
import { getLiveSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { query } from "@/lib/db";
import { kstToday } from "@/lib/home";
import { getPlatformOpen } from "@/lib/platform-config";
import { resolveAreas } from "@/lib/v3/category";
import TaskDetailView from "@/components/v3/TaskDetailView";

export const dynamic = "force-dynamic";

export default async function V3TaskDetail({ params }: { params: { id: string } }) {
  // 스위치는 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다 (§G).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");

  // 번호가 아닌 주소(`/v3/tasks/abc`)는 여기서 끝낸다. 화면까지 보내면
  // 「불러오는 중…」 뒤에 API 오류가 뜨고, 그건 없는 주소가 아니라 고장으로 읽힌다.
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [{ openAt }, areaRows, people] = await Promise.all([
    getPlatformOpen(),
    query<{ id: number; name: string }>(
      `SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`
    ),
    query<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM actor
        WHERE type = 'human' AND is_active = true ORDER BY id`
    ),
  ]);

  return (
    <TaskDetailView
      id={id}
      today={kstToday()}
      openAtMs={Date.parse(openAt)}
      areas={resolveAreas(areaRows)}
      people={people.map((p) => ({ id: p.id, name: p.display_name }))}
    />
  );
}
