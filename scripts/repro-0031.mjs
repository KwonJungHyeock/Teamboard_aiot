// 0031 이 왜 안 돌았는가 — **프로덕션 조건으로 재현한다** (MD-P-2026-032 §A 사후).
//
// **로컬 전용** (지시 32). **전부 롤백 트랜잭션 안에서 돈다 — 아무것도 남기지 않는다.**
//
// 프로덕션 형태 (PM 제공):
//   · goal 프로젝트 6개
//   · 프로젝트 없는 활성 업무 35건
//   · 영역 7개 **전부** `workspace` + 활성
//
// 로컬은 goal 3 · 미귀속 0(이미 옮김) · 영역에 link_only·비활성이 섞여 있다.
// 그래서 **트랜잭션 안에서 로컬을 프로덕션 형태로 바꾼 뒤** 0029~0031 을 순서대로 돌린다.
//
// 무엇을 보는가.
//   · 0031 이 **오류를 내는가** — 낸다면 그 오류가 원인이다
//   · 0031 이 **얼마나 걸리는가** — 오래 걸리면 요청 수명 안에 못 끝났을 수 있다
//   · 몇 행이 바뀌는가
import pg from "pg";
import { readFileSync } from "node:fs";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("repro-0031.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const q = (t, p = []) => client.query(t, p);
const read = (f) => readFileSync(`db/migrations/${f}`, "utf8");

const L = (s) => console.log(s);
try {
  await q("BEGIN");

  // ── 0029~0031 을 되돌려 「적용 전」으로 만든다 (트랜잭션 안) ──
  await q(`UPDATE task t SET project_id = NULL FROM project p
            WHERE t.project_id = p.id AND p.type = 'standing'`);
  await q(`DELETE FROM project WHERE type = 'standing'`);
  await q(`ALTER TABLE project DROP CONSTRAINT IF EXISTS project_standing_no_goal`);
  await q(`ALTER TABLE project DROP CONSTRAINT IF EXISTS project_type_check`);
  await q(`ALTER TABLE project DROP COLUMN IF EXISTS type`);
  await q(`DELETE FROM schema_migrations WHERE filename IN
           ('0029_project_type.sql','0030_standing_projects.sql','0031_orphan_tasks_to_standing.sql')`);

  // ── 프로덕션 형태로 맞춘다 ──
  // 영역 7개 전부 workspace + 활성
  await q(`UPDATE area SET kind = 'workspace', is_active = true`);
  // goal 프로젝트를 6개로 (지금 3개 → 3개 더)
  const projN = Number((await q(`SELECT count(*)::int n FROM project`)).rows[0].n);
  for (let i = projN; i < 6; i++) {
    await q(`INSERT INTO project (name, status, color_key, area_id)
             VALUES ($1, 'active', 'team', (SELECT id FROM area ORDER BY sort_order, id LIMIT 1))`,
            [`[재현] goal 프로젝트 ${i + 1}`]);
  }
  // 프로젝트 없는 활성 업무를 35건으로
  const orphanNow = Number((await q(
    `SELECT count(*)::int n FROM task WHERE is_active AND project_id IS NULL`)).rows[0].n);
  const lead = (await q(`SELECT id FROM actor WHERE type='human' AND is_active ORDER BY id LIMIT 1`)).rows[0].id;
  const areaIds = (await q(`SELECT id FROM area ORDER BY sort_order, id`)).rows.map((r) => r.id);
  for (let i = orphanNow; i < 35; i++) {
    await q(`INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, is_demo)
             VALUES ($1, 'todo', 0, $2, $2, 'team', $3, true)`,
            [`[재현] 미귀속 업무 ${i + 1}`, lead, areaIds[i % areaIds.length]]);
  }

  const before = (await q(`SELECT
      (SELECT count(*)::int FROM project) AS 프로젝트,
      (SELECT count(*)::int FROM task WHERE is_active AND project_id IS NULL) AS 미귀속,
      (SELECT count(*)::int FROM area WHERE kind='workspace' AND is_active) AS 활성workspace영역`)).rows[0];
  L(`재현 조건 — 프로젝트 ${before.프로젝트} · 미귀속 ${before.미귀속} · 활성 workspace 영역 ${before.활성workspace영역}`);
  L(``);

  // ── 0029 → 0030 → 0031 을 러너와 **같은 순서·같은 방식**으로 ──
  for (const f of ["0029_project_type.sql", "0030_standing_projects.sql", "0031_orphan_tasks_to_standing.sql"]) {
    const t0 = process.hrtime.bigint();
    try {
      const r = await q(read(f));
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const rows = Array.isArray(r) ? r.map((x) => x.rowCount).join("/") : r.rowCount;
      L(`OK   ${f.padEnd(36)} ${ms.toFixed(1)}ms · rowCount ${rows}`);
    } catch (e) {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      L(`FAIL ${f.padEnd(36)} ${ms.toFixed(1)}ms`);
      L(`     ${String(e && e.message ? e.message : e)}`);
      L(`     → **이 오류가 0031 이 안 돈 원인이다.**`);
      throw e;
    }
  }

  L(``);
  const after = (await q(`SELECT
      (SELECT count(*)::int FROM task WHERE is_active AND project_id IS NULL) AS 미귀속,
      (SELECT count(*)::int FROM project WHERE type='standing') AS 상시,
      (SELECT count(*)::int FROM task t JOIN project p ON p.id=t.project_id
        WHERE t.is_active AND t.area_id <> p.area_id) AS 영역불일치`)).rows[0];
  L(`결과 — 미귀속 ${after.미귀속} · 상시 프로젝트 ${after.상시} · 영역 불일치 ${after.영역불일치}`);
  L(``);
  L(`판정 — 프로덕션 조건에서 0031 은 **오류 없이 돌고 빠르다.**`);
  L(`       즉 0031 SQL 자체는 원인이 아니다.`);
} catch (e) {
  console.error("재현 중 예외:", String(e && e.message ? e.message : e));
  process.exitCode = 1;
} finally {
  await q("ROLLBACK").catch(() => {});
  // 롤백이 정말 되돌렸는지 확인한다 — 리허설도 확인 없이는 증거가 아니다.
  const back = (await q(`SELECT
      (SELECT count(*)::int FROM project) AS 프로젝트,
      (SELECT count(*)::int FROM task WHERE title LIKE '[재현]%') AS 재현잔여,
      (SELECT count(*)::int FROM schema_migrations WHERE filename LIKE '003%') AS 이력`)).rows[0];
  console.log(`\n롤백 확인 — 프로젝트 ${back.프로젝트} · [재현] 잔여 ${back.재현잔여} · 003x 이력 ${back.이력}`);
  client.release();
  await pool.end().catch(() => {});
}
