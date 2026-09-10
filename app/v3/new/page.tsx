// v3 「새 업무」 (MD-P-2026-045 §B).
//
// 서버가 넘기는 것 둘:
//   · **카테고리** — `area` 를 읽어 id → 색으로 풀어서. 넷이 아니라 area 수만큼이다
//   · **담당 후보** — `actor(type='human')`. 화면은 이름만 그린다
//
// 저장은 화면이 `POST /api/tasks` 로 한다. 새 API 는 없다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { resolveAreas } from "@/lib/v3/category";
import NewTaskView from "@/components/v3/NewTaskView";

export const dynamic = "force-dynamic";

export default async function V3New() {
  // 스위치는 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다 (§G).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");

  const [areaRows, people] = await Promise.all([
    query<{ id: number; name: string }>(
      `SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`
    ),
    query<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM actor
        WHERE type = 'human' AND is_active = true ORDER BY id`
    ),
  ]);

  return (
    <NewTaskView
      areas={resolveAreas(areaRows)}
      people={people.map((p) => ({ id: p.id, name: p.display_name }))}
      me={{ id: live.user.id, name: live.user.name }}
    />
  );
}
