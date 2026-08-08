// 기간이 계층을 결정한다 (MD-P-2026-029 §A).
//
// 8월 목표는 무조건 Q3 에, Q3 는 무조건 그 해 연간에 속한다.
// 기간이 이미 계층을 정하는데 셀렉트로 물어보고 있었고, 그래서 #13·#15 가
// 같은 이름으로 월과 분기에 중복 생겼다.
//
// **파생으로 두지 않고 계산한 값을 실제로 저장한다.** 화면마다 다시 계산하면
// 그 계산이 갈라지고, 갈라진 순간 어느 쪽이 맞는지 아무도 모른다.
// 여기가 계산이 사는 유일한 곳이다.
import { query, queryOne } from "./db";
import { recomputeGoalChain } from "./goals";

export type GoalPeriod = "year" | "quarter" | "month";

/** `2026-08-01` → `2026-07-01` (그 달이 속한 분기의 시작일) */
export function quarterStartOf(periodStart: string): string {
  const y = periodStart.slice(0, 4);
  const m = Number(periodStart.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, "0")}-01`;
}

/** `2026-08-01` → `2026-01-01` (그 해의 시작일) */
export function yearStartOf(periodStart: string): string {
  return `${periodStart.slice(0, 4)}-01-01`;
}

/** 이 주기의 상위가 어떤 주기·어떤 기간이어야 하는가. 연간은 상위가 없다. */
export function parentSpecOf(periodType: GoalPeriod, periodStart: string):
  { periodType: GoalPeriod; periodStart: string } | null {
  if (periodType === "month") return { periodType: "quarter", periodStart: quarterStartOf(periodStart) };
  if (periodType === "quarter") return { periodType: "year", periodStart: yearStartOf(periodStart) };
  return null;
}

export interface ParentCandidate { id: number; title: string }

/**
 * 기간이 가리키는 상위 목표를 찾는다.
 *
 * 스코프를 넘나들지 않는다 — 개인 월 목표가 팀 분기 목표에 붙으면
 * 팀 진척 분모에 남의 개인 업무가 섞인다(§B3 과 같은 이유).
 * 개인은 **같은 사람의** 개인 목표에만 붙는다.
 *
 * 후보가 여럿이면 고르게 해야 하므로(§A3) 목록을 그대로 돌려준다.
 */
export async function findParentCandidates(opts: {
  periodType: GoalPeriod;
  periodStart: string;
  scope: string;
  ownerActorId: number | null;
}): Promise<ParentCandidate[]> {
  const spec = parentSpecOf(opts.periodType, opts.periodStart);
  if (!spec) return [];
  const personal = opts.scope === "personal";
  return query<ParentCandidate>(
    `SELECT id, title FROM goal
      WHERE is_active = true AND period_type = $1 AND period_start = $2::date AND scope = $3
        AND ($4::int IS NULL OR owner_actor_id = $4)
      ORDER BY id`,
    [spec.periodType, spec.periodStart, opts.scope, personal ? opts.ownerActorId : null]
  );
}

/**
 * 저장할 상위 id 를 정한다.
 *   후보 0개 → null (상위 없음. 만들지 말지는 화면이 묻는다 — §A2)
 *   후보 1개 → 그것. 묻지 않는다 (§A3)
 *   후보 여럿 → preferred 가 후보 안에 있으면 그것, 아니면 null (화면이 고르게 한다)
 */
export async function resolveParentId(opts: {
  periodType: GoalPeriod;
  periodStart: string;
  scope: string;
  ownerActorId: number | null;
  preferred?: number | null;
}): Promise<{ parentId: number | null; candidates: ParentCandidate[] }> {
  const candidates = await findParentCandidates(opts);
  if (candidates.length === 0) return { parentId: null, candidates };
  if (candidates.length === 1) return { parentId: candidates[0].id, candidates };
  const hit = opts.preferred && candidates.some((c) => c.id === opts.preferred) ? opts.preferred : null;
  return { parentId: hit, candidates };
}

/**
 * 기간이 바뀐 뒤 상위를 다시 맞춘다 (§A4).
 *
 * `goal_parent_source = 'manual'` 이면 손대지 않는다 — 사람이 정한 것이다 (§A5).
 * 옮겨졌으면 **떠난 쪽과 새로 붙은 쪽 양쪽**을 재계산한다. 한쪽만 하면
 * 떠난 상위에 옛 숫자가 남는다 (지시 27 에서 같은 실수를 한 번 했다).
 */
export async function reparentByPeriod(goalId: number): Promise<{
  moved: boolean; fromId: number | null; toId: number | null;
  fromTitle: string | null; toTitle: string | null;
}> {
  const g = await queryOne<{
    id: number; parent_id: number | null; period_type: GoalPeriod; period_start: string;
    scope: string; owner_actor_id: number | null; goal_parent_source: string;
  }>(
    `SELECT id, parent_id, period_type, period_start::text, scope, owner_actor_id, goal_parent_source
       FROM goal WHERE id = $1 AND is_active = true`,
    [goalId]
  );
  const none = { moved: false, fromId: null, toId: null, fromTitle: null, toTitle: null };
  if (!g) return none;
  if (g.goal_parent_source === "manual") return none;    // 사람이 정한 연결은 따라가지 않는다

  const { parentId } = await resolveParentId({
    periodType: g.period_type, periodStart: g.period_start,
    scope: g.scope, ownerActorId: g.owner_actor_id,
    preferred: g.parent_id,                              // 지금 상위가 여전히 맞으면 그대로 둔다
  });
  if (parentId === g.parent_id) return none;

  const titleOf = async (id: number | null) =>
    id ? (await queryOne<{ title: string }>("SELECT title FROM goal WHERE id = $1", [id]))?.title ?? null : null;
  const fromTitle = await titleOf(g.parent_id);
  const toTitle = await titleOf(parentId);

  await query("UPDATE goal SET parent_id = $1, updated_at = now() WHERE id = $2", [parentId, goalId]);

  // 양쪽 다 재계산한다. 떠난 쪽을 빼먹으면 옛 숫자가 그대로 남는다.
  if (g.parent_id) await recomputeGoalChain(g.parent_id);
  if (parentId) await recomputeGoalChain(parentId);
  await recomputeGoalChain(goalId);

  return { moved: true, fromId: g.parent_id, toId: parentId, fromTitle, toTitle };
}

/** 기간 문자열 → 그 기간의 마지막 날. 화면이 끝날짜를 따로 묻지 않게 한다. */
export function periodEndOf(periodType: GoalPeriod, periodStart: string): string {
  const y = Number(periodStart.slice(0, 4));
  const m = Number(periodStart.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  if (periodType === "year") return `${y}-12-31`;
  const endMonth = periodType === "quarter" ? m + 2 : m;
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return `${y}-${pad(endMonth)}-${lastDay}`;
}
