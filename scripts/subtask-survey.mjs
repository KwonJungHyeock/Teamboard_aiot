// 028 착수 전 실태 조사 — 하위 업무 · 차단 관계 · 정렬 (MD-P-2026-028 준비).
//
// **읽기 전용이다. 아무것도 바꾸지 않는다.** SELECT 뿐이다.
// 030 이 그랬듯, 무엇이 이미 있고 무엇이 없는지 먼저 표로 낸 뒤에 손댄다.
//
//   node scripts/subtask-survey.mjs
import pg from "pg";

const DSN = process.env.DATABASE_URL;
if (!DSN) { console.error("DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;

// lib/progress.ts countableSql 과 같은 조건. 다르면 이 표가 화면과 다른 말을 한다.
const COUNTABLE = (a) => `
  ${a}.is_active = true AND ${a}.status <> 'proposed' AND ${a}.status <> 'dropped'
  AND ${a}.work_type <> 'routine'
  AND (${a}.resolution IS NULL OR ${a}.resolution NOT IN ('canceled','duplicate'))`;

const line = (s) => console.log(s);
const h = (s) => { line(`\n── ${s} ──`); };

try {
  // ── ① 스키마: 세 기능이 쓸 컬럼이 이미 있는가 ─────────────────────
  h("① 스키마 — 이미 있는 것 / 없는 것");
  const cols = await sql(`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_name = 'task'
       AND column_name IN ('parent_task_id','blocked','blocked_by','blocked_reason','blocked_since','sort_order')
     ORDER BY column_name`);
  for (const c of cols) {
    line(`  task.${c.column_name.padEnd(16)} ${c.data_type.padEnd(26)} null허용=${c.is_nullable} 기본값=${c.column_default ?? "없음"}`);
  }
  const want = ["blocked", "blocked_by", "blocked_reason", "blocked_since", "parent_task_id", "sort_order"];
  const missing = want.filter((w) => !cols.some((c) => c.column_name === w));
  line(`  → 없는 컬럼: ${missing.length ? missing.join(", ") : "없음 (여섯 개 다 있다)"}`);

  const fks = await sql(`
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'task'::regclass
       AND (pg_get_constraintdef(oid) LIKE '%parent_task_id%'
         OR pg_get_constraintdef(oid) LIKE '%blocked_by%')
     ORDER BY conname`);
  for (const f of fks) line(`  제약 ${f.conname} — ${f.def}`);
  if (fks.length === 0) line("  제약 없음 — 순환·자기참조를 DB 가 막지 않는다");

  const idx = await sql(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE tablename = 'task' AND (indexdef LIKE '%parent_task_id%' OR indexdef LIKE '%sort_order%')`);
  for (const i of idx) line(`  인덱스 ${i.indexname} — ${i.indexdef.replace(/^CREATE.*USING /, "")}`);
  if (idx.length === 0) line("  인덱스 없음 — 하위 조회·정렬이 전부 순차 스캔이다");

  // ── ② 데이터: 실제로 쓰이고 있는가 ────────────────────────────────
  h("② 데이터 — 실제 사용량");
  const t = await one(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE parent_task_id IS NOT NULL)::int AS children,
           count(DISTINCT parent_task_id)::int AS parents,
           count(*) FILTER (WHERE blocked)::int AS blocked,
           count(*) FILTER (WHERE blocked_by IS NOT NULL)::int AS blocked_by_task,
           count(*) FILTER (WHERE blocked AND blocked_by IS NULL)::int AS blocked_free_text,
           count(*) FILTER (WHERE sort_order IS NOT NULL AND sort_order <> 0)::int AS sorted
      FROM task WHERE is_active = true`);
  line(`  활성 업무          ${t.total}건`);
  line(`  하위 업무          ${t.children}건 (상위 노릇을 하는 업무 ${t.parents}건)`);
  line(`  막힘 표시          ${t.blocked}건 — 그중 업무로 지목 ${t.blocked_by_task}건 · 사유만 ${t.blocked_free_text}건`);
  line(`  sort_order 지정    ${t.sorted}건`);

  // 깊이 — 2단을 넘는 트리가 있으면 규칙부터 정해야 한다.
  const depth = await one(`
    WITH RECURSIVE d AS (
      SELECT id, 1 AS lv FROM task WHERE parent_task_id IS NULL AND is_active
      UNION ALL
      SELECT c.id, d.lv + 1 FROM task c JOIN d ON c.parent_task_id = d.id WHERE c.is_active AND d.lv < 10
    ) SELECT max(lv)::int AS max_depth FROM d`);
  line(`  최대 깊이          ${depth.max_depth}단 (1 = 하위 업무 없음)`);

  // ── ③ 030 이후의 경계 — 하위 업무가 목표에 붙어 있는가 (28-b) ──────
  h("③ 28-b — 하위 업무가 목표에 직접 붙어 있는가");
  const badLinks = await sql(`
    SELECT gt.goal_id, gt.task_id, t.title, t.parent_task_id
      FROM goal_task gt JOIN task t ON t.id = gt.task_id
     WHERE t.parent_task_id IS NOT NULL
     ORDER BY gt.goal_id, gt.task_id`);
  line(`  하위 업무의 goal_task 행 ${badLinks.length}건`);
  for (const b of badLinks) line(`    목표 #${b.goal_id} ← 업무 #${b.task_id} "${b.title}" (상위 #${b.parent_task_id})`);
  line(`  ※ 이런 링크는 **지금도 만들 수 있고, 만들어도 진척에 안 잡힌다.**`);
  line(`     goalSubtreeTaskInput 이 parent_task_id IS NULL 로 거르기 때문이다 —`);
  line(`     즉 "붙였는데 아무 일도 안 일어나는" 조용한 실패다. 28-b 가 막으려는 것이 이것.`);

  // 짝이 되는 존재 단언 — 최상위 업무의 링크는 실제로 있다.
  const okLinks = await one(`
    SELECT count(*)::int AS n FROM goal_task gt JOIN task t ON t.id = gt.task_id
     WHERE t.parent_task_id IS NULL`);
  line(`  (대조) 최상위 업무의 goal_task 행 ${okLinks.n}건 — 조회 자체는 비어 있지 않다`);

  // ── ④ 진척 계산기가 하위 업무를 어떻게 다루고 있는가 (28-a) ────────
  h("④ 28-a — 지금 계산기가 하위 업무를 다루는 방식");
  line(`  lib/progress.ts 규칙 2 — 하위가 1건 이상이면 상위의 진척은 하위 완료율이다`);
  line(`  lib/progress.ts 규칙 3 — 분모는 최상위 업무만. 하위는 상위를 통해 이미 반영됐다`);
  const rolled = await sql(`
    SELECT p.id, p.title, p.progress,
           (SELECT count(*)::int FROM task c WHERE c.parent_task_id = p.id AND ${COUNTABLE("c")}) AS child_counted,
           (SELECT count(*)::int FROM task c WHERE c.parent_task_id = p.id AND ${COUNTABLE("c")}
              AND c.status = 'done' AND (c.resolution IS NULL OR c.resolution <> 'deferred')) AS child_done
      FROM task p WHERE p.is_active AND EXISTS (SELECT 1 FROM task c WHERE c.parent_task_id = p.id AND c.is_active)
     ORDER BY p.id`);
  if (rolled.length === 0) {
    line(`  하위를 가진 업무 0건 — **계산기의 하위 경로가 실데이터로 한 번도 안 밟혔다.**`);
    line(`  028 은 여태 안 밟힌 분기를 처음 밟게 만든다. 그 사실을 알고 시작한다.`);
  }
  for (const r of rolled) {
    const roll = r.child_counted > 0 ? Math.round((100 * r.child_done) / r.child_counted) : null;
    line(`  #${r.id} "${r.title}" 저장된 진척 ${r.progress}% · 하위 ${r.child_done}/${r.child_counted} → 롤업 ${roll}%`);
  }

  // ── ⑤ 정렬 — 지금 목록이 무엇으로 정렬되는가 ──────────────────────
  h("⑤ 정렬 — sort_order 의 현재 상태");
  const so = await sql(`
    SELECT COALESCE(project_id, 0) AS project_id, count(*)::int AS n,
           count(DISTINCT sort_order)::int AS distinct_orders,
           min(sort_order)::int AS lo, max(sort_order)::int AS hi
      FROM task WHERE is_active GROUP BY 1 ORDER BY 1`);
  for (const r of so) {
    line(`  프로젝트 ${r.project_id === 0 ? "없음" : `#${r.project_id}`} — 업무 ${r.n}건 · ` +
         `서로 다른 sort_order ${r.distinct_orders}가지 (${r.lo}~${r.hi})`);
  }
  line(`  ※ 서로 다른 값이 1가지면 정렬 기준이 사실상 없다 — 드래그 정렬은 값부터 채워야 한다.`);
} finally {
  await pool.end();
}
