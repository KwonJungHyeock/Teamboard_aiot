// 프로젝트 경유를 빼면 목표 진척이 어떻게 바뀌는가 (MD-P-2026-030 §C1).
//
// **읽기 전용이다. 아무것도 바꾸지 않는다.** 지시서가 "실행은 그 뒤에" 라고 못 박았다.
// 코드도 마이그레이션도 건드리기 전에, 무엇이 얼마나 바뀌는지 표로 먼저 낸다.
//
// 지금 계산식 (lib/projects.ts goalSubtreeTaskInput):
//   목표 하위 트리에 속한 업무 =
//     ① 그 목표(또는 하위 목표)에 **직접** 연결된 업무 (goal_task)
//     ② 그 목표(또는 하위 목표)를 goal_id 로 가리키는 **프로젝트**의 업무   ← 이번에 뺀다
//
//   node scripts/goal-link-impact.mjs
import pg from "pg";

const DSN = process.env.DATABASE_URL;
if (!DSN) { console.error("DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;

// lib/progress.ts 의 countableSql 과 같은 조건이어야 한다.
// 다르면 이 표가 실제 계산과 다른 말을 하게 된다 — 그게 이번 지시서가 지적한 바로 그 문제다.
const COUNTABLE = (a) => `
  ${a}.is_active = true AND ${a}.status <> 'proposed' AND ${a}.work_type <> 'routine'
  AND NOT (${a}.status = 'dropped')
  AND (${a}.resolution IS NULL OR ${a}.resolution <> 'deferred')`;

/** 한 목표의 하위 트리 업무를 모은다. withProject=false 면 프로젝트 경유를 뺀다. */
const subtreeTasks = (withProject) => `
  WITH RECURSIVE sub AS (
    SELECT id FROM goal WHERE id = $1 AND is_active = true
    UNION ALL
    SELECT g.id FROM goal g JOIN sub ON g.parent_id = sub.id WHERE g.is_active = true
  )
  SELECT DISTINCT t.id, t.status, t.progress::float AS progress, t.resolution
    FROM task t
    ${withProject ? "LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true AND p.status <> 'archived'" : ""}
   WHERE t.parent_task_id IS NULL AND ${COUNTABLE("t")}
     AND ( ${withProject ? "p.goal_id IN (SELECT id FROM sub) OR " : ""}
           EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id AND gt.goal_id IN (SELECT id FROM sub)) )`;

/** lib/progress.ts aggregateTasks 와 같은 규칙 — 완료는 100, 그 외는 progress. */
function aggregate(tasks) {
  if (tasks.length === 0) return null;
  const sum = tasks.reduce((a, t) => a + (t.status === "done" ? 100 : Number(t.progress) || 0), 0);
  return Math.round(sum / tasks.length);
}

try {
  // ── 프로젝트→목표 연결 현황 ──────────────────────────────────────
  const links = await sql(`
    SELECT p.id AS project_id, p.name AS project_name, p.goal_id,
           g.title AS goal_title, g.period_type, g.period_start::text AS period_start,
           (SELECT count(*) FROM task t WHERE t.project_id = p.id AND ${COUNTABLE("t")}) AS task_n
      FROM project p JOIN goal g ON g.id = p.goal_id
     WHERE p.is_active = true AND g.is_active = true
     ORDER BY g.id, p.id`);

  console.log(`\n── 프로젝트 → 목표 연결 ${links.length}건 ──`);
  if (links.length === 0) console.log("  없음");
  for (const l of links) {
    console.log(`  프로젝트 #${l.project_id} ${l.project_name}  →  목표 #${l.goal_id} ${l.goal_title} (${l.period_type} ${l.period_start}) · 집계 대상 업무 ${l.task_n}건`);
  }

  // ── 영향을 받는 목표 = 연결된 목표 + 그 조상 전부 ─────────────────
  const affected = new Set(links.map((l) => l.goal_id));
  for (const id of Array.from(affected)) {
    let cur = id, depth = 0;
    while (cur && depth < 4) {
      const p = (await sql(`SELECT parent_id FROM goal WHERE id = $1`, [cur]))[0];
      cur = p?.parent_id ?? null;
      if (cur) affected.add(cur);
      depth += 1;
    }
  }

  const rows = [];
  for (const id of Array.from(affected).sort((a, b) => a - b)) {
    const g = (await sql(
      `SELECT id, title, period_type, period_start::text AS ps, progress::float AS progress,
              progress_auto::float AS auto, progress_manual::float AS manual
         FROM goal WHERE id = $1`, [id]))[0];
    const withP = await sql(subtreeTasks(true), [id]);
    const noP = await sql(subtreeTasks(false), [id]);
    const before = aggregate(withP);
    const after = aggregate(noP);
    // 수동값이 있으면 실효값은 그대로다 — 집계만 바뀐다. 그 사실도 표에 남긴다.
    rows.push({
      id, title: g.title, type: g.period_type, ps: g.ps,
      manual: g.manual, beforeN: withP.length, afterN: noP.length,
      before, after,
      effBefore: g.manual !== null ? Math.round(g.manual) : before,
      effAfter: g.manual !== null ? Math.round(g.manual) : after,
    });
  }

  console.log(`\n── 프로젝트 경유를 빼면 바뀌는 목표 ${rows.length}건 ──`);
  console.log("  (연결된 목표 + 그 조상 전부. 조상은 하위 트리를 타고 영향을 받는다)\n");
  const f = (v) => (v === null ? "집계 없음" : `${v}%`);
  for (const r of rows) {
    const changed = r.effBefore !== r.effAfter || r.beforeN !== r.afterN;
    console.log(`  #${String(r.id).padEnd(3)} ${r.title}`);
    console.log(`        ${r.type} ${r.ps}${r.manual !== null ? ` · 수동값 ${Math.round(r.manual)}%` : ""}`);
    console.log(`        집계 대상 업무  ${r.beforeN}건 → ${r.afterN}건`);
    console.log(`        집계값         ${f(r.before)} → ${f(r.after)}`);
    console.log(`        화면에 뜨는 값   ${f(r.effBefore)} → ${f(r.effAfter)}   ${changed ? "← 바뀜" : "(그대로)"}\n`);
  }

  // ── §B 배너와 진척 계산기의 기준 차이 ────────────────────────────
  // 지금 배너가 세는 것과, 진척 계산기가 세는 것이 다르다. 그 차이를 숫자로 낸다.
  // lib/progress.ts 의 unlinkedTaskSql 과 **글자 그대로 같은 조건**이어야 한다.
  //   parent_task_id IS NULL 이 빠져 있어서 이 표만 하위 업무를 함께 세고 있었다 —
  //   실제 배너보다 큰 수가 나온다. 표가 화면과 다른 말을 하면 표를 믿을 수 없다.
  const bannerNow = (await sql(`
    SELECT count(*) AS n FROM task t
     WHERE t.parent_task_id IS NULL AND ${COUNTABLE("t")} AND t.visibility = 'team'
       AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id)
       AND t.goal_source <> 'none'`))[0].n;
  const viaProject = (await sql(`
    SELECT count(*) AS n FROM task t
     JOIN project p ON p.id = t.project_id AND p.goal_id IS NOT NULL
     WHERE t.parent_task_id IS NULL AND ${COUNTABLE("t")} AND t.visibility = 'team'
       AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id)`))[0].n;
  // 프로젝트 경유가 만드는 진짜 왜곡 — "남의 목표에 붙은 업무가 이 목표 분모에 섞인다".
  // 프로젝트가 8월 목표를 가리키면, 그 프로젝트의 7월 업무까지 8월 분모에 들어간다.
  const crossed = await sql(`
    SELECT p.goal_id, g.title, count(*) AS n
      FROM task t
      JOIN project p ON p.id = t.project_id AND p.goal_id IS NOT NULL
      JOIN goal g ON g.id = p.goal_id
     WHERE ${COUNTABLE("t")} AND t.parent_task_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id AND gt.goal_id = p.goal_id)
     GROUP BY p.goal_id, g.title ORDER BY p.goal_id`);
  const crossedTotal = crossed.reduce((a, c) => a + Number(c.n), 0);

  console.log(`── §B 기준 차이 ──`);
  console.log(`  배너가 세는 미연결(직접 연결 없음 · goal_source<>none)      ${bannerNow}건`);
  console.log(`  그중 프로젝트 경유로 진척에는 잡히던 업무                  ${viaProject}건`);
  console.log(`  → 배너와 진척이 서로 다른 집합을 보고 있다는 뜻이다.`);
  console.log(`\n  프로젝트 경유가 끌어오는, **그 목표에 직접 붙지 않은** 업무  ${crossedTotal}건`);
  for (const c of crossed) {
    console.log(`    목표 #${c.goal_id} ${c.title} 분모에 섞이는 남의 업무 ${c.n}건`);
  }
  console.log(`  → 프로젝트가 8월 목표를 가리키면 그 프로젝트의 7월 업무까지 8월 분모에 들어간다.`);
  console.log(`     이것이 "연결 경로가 둘"의 실제 증상이다.\n`);

  // ── §A4 goal_source 현황 ────────────────────────────────────────
  const src = await sql(`SELECT goal_source, count(*) AS n FROM task WHERE is_active = true GROUP BY 1 ORDER BY 1`);
  const inheritedWithLink = (await sql(`
    SELECT count(*) AS n FROM task t
     WHERE t.is_active = true AND t.goal_source = 'inherited'
       AND EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id)`))[0].n;
  console.log(`── §A4 goal_source 현황 ──`);
  for (const s of src) console.log(`  ${s.goal_source.padEnd(10)} ${s.n}건`);
  console.log(`  그중 inherited 인데 직접 링크가 있는 것 ${inheritedWithLink}건 → manual 로 옮길 대상`);
  console.log(`  나머지 inherited 는 링크가 없으므로 그대로 두고 미지정으로 본다 (§A4)\n`);
} finally {
  await pool.end();
}
