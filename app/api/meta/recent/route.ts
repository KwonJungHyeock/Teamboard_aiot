// 최근 본 것 — 제목 해석 (MD-P-2026-031 §C3 ④).
//
// 브라우저는 **종류와 id 만** 들고 있다(`lib/recent.ts` 참고). 제목은 여기서 준다.
// 그래야 ① 이름을 고치면 레일도 같이 바뀌고 ② 개인 항목의 제목이 브라우저에 남지 않는다.
//
// **못 찾은 것은 응답에서 빠진다. 오류가 아니다.**
// 지워졌을 수도 있고, 볼 수 없는 남의 개인 항목일 수도 있다. 둘을 구분해 말하지 않는다 —
// "볼 수 없습니다"는 그 자체로 존재를 알려 주는 말이다. 조용히 목록에서 빠지는 것이 답이다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { visibleTaskSql } from "@/lib/visibility";
import { decodeRefs, RECENT_LABEL, type RecentItem } from "@/lib/recent";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const refs = decodeRefs(new URL(request.url).searchParams.get("items"));
    if (refs.length === 0) return NextResponse.json({ items: [] });

    const idsOf = (k: string) => refs.filter((r) => r.kind === k).map((r) => r.id);
    const taskIds = idsOf("task"), goalIds = idsOf("goal"), projectIds = idsOf("project");

    const [tasks, goals, projects] = await Promise.all([
      taskIds.length
        ? query<{ id: number; title: string }>(
            `SELECT t.id, t.title FROM task t
              WHERE t.id = ANY($1::int[]) AND t.is_active = true AND ${visibleTaskSql("$2")}`,
            [taskIds, session.id])
        : [],
      goalIds.length
        // 남의 개인 목표는 안 준다 (§E 열람 경계). 팀장 예외를 여기 두지 않는다 —
        // 예외를 화면마다 다시 적으면 언젠가 한 곳이 빠진다.
        ? query<{ id: number; title: string }>(
            `SELECT id, title FROM goal
              WHERE id = ANY($1::int[]) AND is_active = true
                AND (scope = 'team' OR owner_actor_id = $2)`,
            [goalIds, session.id])
        : [],
      projectIds.length
        ? query<{ id: number; name: string }>(
            `SELECT id, name FROM project WHERE id = ANY($1::int[]) AND is_active = true`,
            [projectIds])
        : [],
    ]);

    const found = new Map<string, string>();
    for (const t of tasks) found.set(`task:${t.id}`, t.title);
    for (const g of goals) found.set(`goal:${g.id}`, g.title);
    for (const p of projects) found.set(`project:${p.id}`, p.name);

    // **브라우저가 준 순서를 지킨다.** 최근 본 순서가 이 목록의 유일한 뜻이다.
    const items: RecentItem[] = [];
    for (const r of refs) {
      const title = found.get(`${r.kind}:${r.id}`);
      if (title === undefined) continue;   // 지워졌거나 볼 수 없다 — 조용히 건너뛴다
      items.push({
        ...r, title, label: RECENT_LABEL[r.kind],
        href:
          r.kind === "task" ? `/tasks?panel=task:${r.id}`
          : r.kind === "goal" ? `/goals?panel=goal:${r.id}`
          : `/projects/${r.id}`,
      });
    }
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}
