// v3 「팀 현황」 (MD-P-2026-052 §A).
//
// 서버가 정해서 넘기는 것 셋:
//   · **오늘 날짜(KST)** — 「지남」과 「이번 주」를 브라우저 시계로 세지 않는다
//   · **카테고리 색** — `area` 를 읽어 id → 색으로 풀어서
//   · **담당자** — `actor(type='human', is_active)` + `account.role`·`admin_grant`.
//     **이름을 코드에 안 박는다**(§G) — 계정이 늘면 열도 는다.
//
// 데이터는 화면이 `/api/tasks` 에서 가져온다. 새 API 는 없다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { query } from "@/lib/db";
import { kstToday } from "@/lib/home";
import { resolveAreas } from "@/lib/v3/category";
import { ADMIN_GRANT_SQL } from "@/lib/auth";
import TeamView from "@/components/v3/TeamView";

export const dynamic = "force-dynamic";

export default async function V3Team() {
  // 스위치는 `app/v3/layout.tsx` 가 뿌리에서 한 번 막는다 (§G).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");

  const [areaRows, people] = await Promise.all([
    query<{ id: number; name: string }>(
      `SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`
    ),
    /*
     * 열이 되는 사람들. 역할 배지를 그리려면 `account` 가 필요하다.
     *
     * `admin_grant` 는 **컬럼이 없어도 죽지 않는 방식**으로 읽는다
     * (`ADMIN_GRANT_SQL`) — 0034 가 아직 안 적용된 환경에서 이 화면 하나가
     * 500 을 내면, 배포 직후에 그 사실을 아무도 모른다.
     */
    query<{ id: number; display_name: string; role: string | null; admin_grant: boolean | null }>(
      // 별칭은 `lib/auth.ts` 와 같게 — `ac` 가 account 다. 그래야 그 파일의
      // `ADMIN_GRANT_SQL` 을 **글자 그대로** 쓸 수 있다.
      `SELECT a.id, a.display_name, ac.role, ${ADMIN_GRANT_SQL}
         FROM actor a LEFT JOIN account ac ON ac.actor_id = a.id
        WHERE a.type = 'human' AND a.is_active = true
        ORDER BY a.id`
    ),
  ]);

  // `useSearchParams` 는 Suspense 경계를 요구한다 — 거른 조건이 주소에 담기므로.
  return (
    <Suspense fallback={<p className="v3-loading">불러오는 중…</p>}>
      <TeamView
        today={kstToday()}
        areas={resolveAreas(areaRows)}
        people={people.map((p) => ({
          id: p.id,
          name: p.display_name,
          role: p.role ?? "member",
          adminGrant: p.admin_grant === true,
        }))}
      />
    </Suspense>
  );
}
