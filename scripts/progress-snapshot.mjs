// MD-P-2026-024 [3] 검증 — 진척값 before/after 비교용 스냅샷.
// 마이그레이션·계산기 교체 전후로 같은 스크립트를 돌려 값을 비교한다.
// before 는 "화면마다 다른 5가지 프로젝트 공식"을 전부 찍는다 — 통합 후 하나로 모이는 걸 보이기 위해서다.
//
//   node scripts/progress-snapshot.mjs before   → /tmp/progress-before.json
//   node scripts/progress-snapshot.mjs after    → /tmp/progress-after.json
import pg from "pg";
import fs from "node:fs";

const tag = process.argv[2] ?? "snap";
const url = fs.readFileSync(".env.local", "utf8").match(/postgres[^\s"']+/)[0];
const pool = new pg.Pool({ connectionString: url });
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

const hasCol = async (t, c) =>
  (await q(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c])).length > 0;

const HAS_RES = await hasCol("task", "resolution");
const HAS_PARENT = await hasCol("task", "parent_task_id");
// after 스키마에서만 존재하는 컬럼 — before 실행 시엔 중립값으로 대체한다.
const RES = HAS_RES ? "t.resolution" : "NULL::text";
const PARENT = HAS_PARENT ? "t.parent_task_id" : "NULL::int";

// ── 목표 상위 10건 — 저장된 진척(화면이 읽는 값)
const goals = await q(`
  SELECT g.id, left(g.title, 34) AS title, g.period_type, g.progress_mode,
         g.progress::text AS progress, g.progress_auto::text AS progress_auto,
         g.progress_manual::text AS progress_manual, g.status_manual,
         g.period_start::text AS period_start, g.period_end::text AS period_end
    FROM goal g WHERE g.is_active = true ORDER BY g.id LIMIT 10`);

// ── 프로젝트 상위 10건 — 화면별로 다른 공식들을 나란히
const projects = await q(`
  SELECT p.id, left(p.name, 26) AS name,
         -- A. lib/home.ts : done→100, proposed 만 제외 (dropped 포함)
         round(avg(CASE WHEN t.status='done' THEN 100 ELSE t.progress END)
               FILTER (WHERE t.status <> 'proposed'))::text AS home_avg,
         -- F. app/api/projects : done / non-proposed 개수비
         CASE WHEN count(t.id) FILTER (WHERE t.status <> 'proposed') > 0
              THEN round(100.0 * count(t.id) FILTER (WHERE t.status='done')
                         / count(t.id) FILTER (WHERE t.status <> 'proposed'))::text END AS api_done_ratio,
         -- H. app/api/unfurl : 필터 없는 raw avg
         round(avg(t.progress))::text AS unfurl_avg,
         -- 참고 카운트
         count(t.id) FILTER (WHERE t.status <> 'proposed')::text AS total_nonproposed,
         count(t.id) FILTER (WHERE t.status <> 'proposed' AND t.status <> 'dropped')::text AS total_counted,
         count(t.id) FILTER (WHERE t.status='done')::text AS done_cnt,
         count(t.id) FILTER (WHERE ${PARENT} IS NULL)::text AS toplevel_cnt,
         count(t.id) FILTER (WHERE ${RES} IN ('canceled','duplicate'))::text AS excluded_res
    FROM project p
    LEFT JOIN task t ON t.project_id = p.id AND t.is_active = true
   WHERE p.is_active = true GROUP BY p.id, p.name ORDER BY p.id LIMIT 10`);

// ── 업무 상위 10건 — 저장 진척 + 하위 업무 현황
const tasks = await q(`
  SELECT t.id, left(t.title, 34) AS title, t.status, t.progress::text AS progress,
         ${RES} AS resolution, ${PARENT} AS parent_task_id,
         ${HAS_PARENT ? "(SELECT count(*) FROM task c WHERE c.parent_task_id = t.id)::text" : "'0'"} AS child_cnt
    FROM task t WHERE t.is_active = true AND t.status <> 'proposed'
   ORDER BY t.id LIMIT 10`);

const out = { tag, at: new Date().toISOString(), schema: { HAS_RES, HAS_PARENT }, goals, projects, tasks };
fs.writeFileSync(`/tmp/progress-${tag}.json`, JSON.stringify(out, null, 2));

const p = (rows, cols) => {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "—").length)));
  console.log(cols.map((c, i) => c.padEnd(w[i])).join("  "));
  for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? "—").padEnd(w[i])).join("  "));
};
console.log(`\n===== [${tag}] 목표 =====`);
p(goals, ["id", "title", "period_type", "progress_mode", "progress", "progress_auto", "progress_manual"]);
console.log(`\n===== [${tag}] 프로젝트 =====`);
p(projects, ["id", "name", "home_avg", "api_done_ratio", "unfurl_avg", "total_nonproposed", "total_counted", "done_cnt", "toplevel_cnt", "excluded_res"]);
console.log(`\n===== [${tag}] 업무 =====`);
p(tasks, ["id", "title", "status", "progress", "resolution", "parent_task_id", "child_cnt"]);
await pool.end();
