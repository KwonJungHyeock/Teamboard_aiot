// 검사가 만든 계정을 **완전히** 지운다 (MD-P-2026-031 §C 회신 · 2-3).
//
// ── 왜 공용으로 빼는가 ──────────────────────────────────────────
//
// `first-run-walk` 이 정리 단계에서 죽고 있었다.
//
//     update or delete on table "actor" violates foreign key constraint
//     "read_marker_user_id_fkey" on table "read_marker"
//
// 지울 테이블을 **손으로 나열**했기 때문이다. `activity_log` · `notification` 은 적혀 있었고
// `read_marker` 는 없었다. 그리고 정리가 예외로 죽으니 **계정이 매 회차 하나씩 남았다** —
// 실제로 「신규 팀원」 셋이 쌓여 있었다.
//
// 손 목록은 스키마가 늘 때마다 낡는다. `actor(id)` 를 참조하는 곳은 지금 **39군데**다.
// 그래서 **스키마에 물어보고** 지운다. 테이블이 늘어도 이 함수는 안 바뀐다.
//
// ── 한계를 적어 둔다 ────────────────────────────────────────────
//
// 2차 참조(그 사람이 만든 **업무**를 또 다른 테이블이 가리키는 경우)까지 일반화하지 않았다.
// 그건 그래프 순회가 되고, 검사 정리에 그만한 기계는 과하다.
// 그 대신 업무 계열만 **이름을 적어** 먼저 끊는다 — 아래 `TASK_FIRST` 가 그것이고,
// 여기 없는 2차 참조가 생기면 이 함수가 아니라 **그 목록**을 고치면 된다.
import process from "node:process";

/** 업무를 가리키는 것들 — actor 를 지우기 전에 그 사람의 업무부터 끊어야 한다. */
const TASK_FIRST = [
  ["activity_log", "task_id"],
  ["signal", "task_id"],
  ["task_comment", "task_id"],
  ["goal_task", "task_id"],
  ["saved_item", "item_id"],
];

/**
 * @param sql  `(text, params) => rows` 형태의 실행기
 * @param actorId 지울 사람
 * @returns {Promise<{removed: string[], left: number}>} 지운 자리와 남은 actor 수(0이어야 한다)
 */
export async function purgeActor(sql, actorId) {
  const removed = [];
  const run = async (label, text, params) => {
    try {
      const rows = await sql(text + " RETURNING 1", params);
      if (rows.length) removed.push(`${label} ${rows.length}`);
    } catch { /* 참조가 남아 있으면 다음 차수에서 다시 시도한다 */ }
  };

  // ① 이 사람이 소유한 에이전트부터. 에이전트도 actor 라 같은 참조를 갖는다.
  const agents = await sql(`SELECT id FROM actor WHERE owner_actor_id = $1`, [actorId]);

  // ② actor(id) 를 참조하는 모든 (테이블, 컬럼) 을 스키마에서 읽는다.
  const refs = await sql(`
    SELECT tc.table_name AS t, kcu.column_name AS c
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name = 'actor' AND ccu.column_name = 'id'`);

  const ids = [actorId, ...agents.map((a) => a.id)];

  // ③ 업무 2차 참조를 먼저 끊는다.
  for (const [t, c] of TASK_FIRST) {
    await run(t, `DELETE FROM ${t} WHERE ${c} IN
      (SELECT id FROM task WHERE created_by = ANY($1::int[]) OR assignee_id = ANY($1::int[]))`, [ids]);
  }

  // ④ 직접 참조를 훑는다. 순서를 모르니 **두 번 돈다** — 한 번에 안 지워지는 것이 있다.
  for (let pass = 0; pass < 2; pass++) {
    for (const { t, c } of refs) {
      if (t === "actor") continue;          // 에이전트는 마지막에 지운다
      await run(`${t}.${c}`, `DELETE FROM ${t} WHERE ${c} = ANY($1::int[])`, [ids]);
    }
  }

  // ⑤ 에이전트 → 사람 순으로.
  await run("actor(에이전트)", `DELETE FROM actor WHERE owner_actor_id = $1`, [actorId]);
  await run("actor", `DELETE FROM actor WHERE id = $1`, [actorId]);

  const left = (await sql(`SELECT count(*)::int n FROM actor WHERE id = ANY($1::int[])`, [ids]))[0].n;
  return { removed, left };
}

/** 정리 결과를 사람이 읽는 한 줄로. **남은 것이 있으면 크게 말한다.** */
export function purgeReport(actorId, { removed, left }) {
  const head = `정리 — actor ${actorId}`;
  if (left) return `${head} · ⚠ 잔여 ${left}건 (지워지지 않았다)`;
  return `${head} 삭제 완료${removed.length ? ` · ${removed.join(" · ")}` : ""}`;
}
