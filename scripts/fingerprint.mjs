// 시작 전 지문 — 회차 앞뒤로 같은 값을 찍는다 (MD-P-2026-064 §0).
//
// ── 왜 파일로 만드는가 ──────────────────────────────────────────
//
// 지문을 회차마다 손으로 적은 SQL 로 재고 있었다. 그러다 063 에서 **영역을
// 개수로만 세는 지문**이 어긋남을 통째로 놓쳤다 — 시드를 다시 돌린 것이
// `교육자료` 의 `kind` 와 `기타` 의 `is_active` 를 schema.sql 값으로 되돌렸는데,
// 영역 개수는 7 그대로라 지문이 「같다」고 말했다. 검사기 넷이 빨개지고 나서야
// 알았다.
//
// 세는 항목이 손으로 적히면 회차마다 달라진다. 한 곳에 둔다.
//
// ── 무엇을 찍는가 ───────────────────────────────────────────────
//
// 개수만 찍지 않는다. **상태가 있는 것은 상태까지** 찍는다 —
// 영역은 `kind` 와 `is_active`, 계정은 역할과 관리자 권한.
// 개수는 같은데 성질이 달라진 경우가 063 에서 실제로 났다.
//
// 읽기만 한다. **로컬 전용.**
//
//   DATABASE_URL=... node scripts/fingerprint.mjs
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("fingerprint.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0];

try {
  const sw = await one(`SELECT value::text v FROM config WHERE key = 'ui_v3_enabled'`);
  const n = await one(`
    SELECT (SELECT count(*)::int FROM actor WHERE is_active AND type = 'human')  people,
           (SELECT count(*)::int FROM actor WHERE is_active AND type = 'agent')  agents,
           (SELECT count(*)::int FROM area)                                      areas,
           (SELECT count(*)::int FROM project)                                   projects,
           (SELECT count(*)::int FROM project WHERE is_active)                   projects_on,
           (SELECT count(*)::int FROM task)                                      tasks,
           (SELECT count(*)::int FROM task WHERE is_active)                      tasks_on,
           (SELECT count(*)::int FROM goal)                                      goals`);
  /* 검사기가 만들고 안 치운 것 — 표식이 붙은 업무·프로젝트. 0이어야 한다. */
  const junk = await one(
    `SELECT (SELECT count(*)::int FROM task    WHERE title ~ $1) t,
            (SELECT count(*)::int FROM project WHERE name  ~ $1) p`,
    ["\\[(실측|검사|경계검사|탐침|0[0-9][0-9][가-힣]*검사|0[0-9][0-9]영역|MD0)"]);

  console.log(`스위치 ${sw ? sw.v : "(행 없음)"}`);
  console.log(`사람 ${n.people} · 에이전트 ${n.agents} · 영역 ${n.areas}` +
              ` · 프로젝트 ${n.projects}(활성 ${n.projects_on})` +
              ` · 업무 ${n.tasks}(활성 ${n.tasks_on}) · 목표 ${n.goals}`);
  console.log(`검사 잔여 — 업무 ${junk.t} · 프로젝트 ${junk.p} (둘 다 0이어야 한다)`);

  /*
   * 064 §0 — **영역은 상태까지 찍는다.** 개수만 세면 063 의 어긋남을 또 놓친다.
   * 한 줄로 늘어놓는다 — 지문은 눈으로 앞뒤를 맞대 보는 것이라 여러 줄이면 못 맞댄다.
   */
  const areas = await sql(`SELECT id, name, kind, is_active FROM area ORDER BY sort_order, id`);
  console.log(`영역 — ${areas.map((a) => `${a.name}(${a.kind}${a.is_active ? "" : "·꺼짐"})`).join(" · ")}`);

  const accounts = await sql(
    `SELECT a.actor_id id, ac.display_name nm, a.role, a.admin_grant g
       FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active ORDER BY a.actor_id`);
  console.log(`계정 — ${accounts.map((a) => `#${a.id} ${a.nm}:${a.role}${a.g ? "+G" : ""}`).join(" · ")}`);
} finally {
  await pool.end();
}
