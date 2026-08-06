// MD-P-2026-024 [지시 4 / 10-2] 데모 데이터 하드 삭제.
//
// 순서를 지킨다: 참조(연결) 해제 → 하위 → 상위.
//   1) 시그널 8건   2) 업무 20건(#10 포함)   3) 목표 7건
//
// 안전장치 (지시 4-4):
//   - 삭제 직전 대상 건수를 다시 센다.
//   - is_demo = false 인 행이 대상에 하나라도 섞이면 **즉시 중단**한다.
//   - --apply 없이는 아무것도 지우지 않는다(드라이런이 기본).
//   - 전체가 하나의 트랜잭션이다. 중간에 실패하면 전부 되돌린다.
//
//   DATABASE_URL=... node scripts/md024-purge-demo.mjs            # 드라이런
//   DATABASE_URL=... node scripts/md024-purge-demo.mjs --apply    # 실행
import pg from "pg";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL
  ?? fs.readFileSync(".env.local", "utf8").match(/postgres[^\s"']+/)[0];
const pool = new pg.Pool({ connectionString: url });
const c = await pool.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const n = async (sql, p = []) => Number((await q(sql, p))[0].n);

try {
  await c.query("BEGIN");

  // ── 대상 확정 — is_demo 플래그만 신뢰한다. id 목록을 손으로 박지 않는다.
  const sig = (await q(`SELECT id FROM signal WHERE is_demo = true ORDER BY id`)).map((r) => r.id);
  const tsk = (await q(`SELECT id FROM task   WHERE is_demo = true ORDER BY id`)).map((r) => r.id);
  const gol = (await q(`SELECT id FROM goal   WHERE is_demo = true ORDER BY id`)).map((r) => r.id);

  console.log(`대상 — 시그널 ${sig.length}건 [${sig}]`);
  console.log(`대상 — 업무   ${tsk.length}건 [${tsk}]`);
  console.log(`대상 — 목표   ${gol.length}건 [${gol}]`);

  // ── 지시 4-4: is_demo=false 혼입 검사 (이중 확인)
  const leak =
    (await n(`SELECT count(*)::text AS n FROM signal WHERE id = ANY($1::int[]) AND is_demo = false`, [sig])) +
    (await n(`SELECT count(*)::text AS n FROM task   WHERE id = ANY($1::int[]) AND is_demo = false`, [tsk])) +
    (await n(`SELECT count(*)::text AS n FROM goal   WHERE id = ANY($1::int[]) AND is_demo = false`, [gol]));
  if (leak > 0) throw new Error(`중단 — 대상에 is_demo=false 인 행이 ${leak}건 섞였습니다.`);
  console.log("is_demo=false 혼입: 0건 ✅");

  // ── 실데이터가 데모를 참조하고 있지 않은지 확인. 있으면 중단한다.
  //    (데모를 지우다 실데이터가 딸려 나가면 안 된다)
  const refs = [
    ["실데이터 업무가 데모 업무를 상위로 지정",
      `SELECT count(*)::text AS n FROM task WHERE parent_task_id = ANY($1::int[]) AND is_demo = false`, tsk],
    ["실데이터 업무가 데모 업무에 차단됨",
      `SELECT count(*)::text AS n FROM task WHERE blocked_by = ANY($1::int[]) AND is_demo = false`, tsk],
    ["실데이터 시그널이 데모 업무를 참조",
      `SELECT count(*)::text AS n FROM signal WHERE task_id = ANY($1::int[]) AND is_demo = false`, tsk],
    ["실데이터 목표가 데모 목표를 상위로 지정",
      `SELECT count(*)::text AS n FROM goal WHERE parent_id = ANY($1::int[]) AND is_demo = false`, gol],
    ["활성 프로젝트가 데모 목표에 연결",
      `SELECT count(*)::text AS n FROM project WHERE goal_id = ANY($1::int[])`, gol],
    // decision.discussion_id 는 NOT NULL 이다 — 시그널을 지우려면 결정을 함께 지워야 한다.
    // 결정은 이 제품의 1급 기록이고 is_demo 플래그도 없다. 승인 없이 지우지 않는다.
    ["데모 시그널을 참조하는 결정(별도 승인 필요)",
      `SELECT count(*)::text AS n FROM decision WHERE discussion_id = ANY($1::int[])`, sig],
  ];
  for (const [label, sql, ids] of refs) {
    const cnt = await n(sql, [ids]);
    console.log(`  ${label}: ${cnt}건${cnt ? " ❌" : ""}`);
    if (cnt > 0) throw new Error(`중단 — ${label} ${cnt}건. 먼저 정리해야 합니다.`);
  }

  // ── 삭제 (연결 → 하위 → 상위)
  const del = async (label, sql, p = []) => {
    const r = await c.query(sql, p);
    console.log(`  ${label}: ${r.rowCount}행`);
  };

  console.log("\n① 시그널 8건 — 연결 해제 후 삭제");
  await del("review_item(시그널)", `DELETE FROM review_item WHERE signal_id = ANY($1::int[])`, [sig]);
  await del("comment(시그널)",     `DELETE FROM comment     WHERE signal_id = ANY($1::int[])`, [sig]);
  await del("decision(논의)",      `UPDATE decision SET discussion_id = NULL WHERE discussion_id = ANY($1::int[])`, [sig]);
  await del("signal",              `DELETE FROM signal WHERE id = ANY($1::int[])`, [sig]);

  console.log("\n② 업무 20건 — 연결 해제 → 하위 → 상위");
  await del("goal_task",     `DELETE FROM goal_task     WHERE task_id = ANY($1::int[])`, [tsk]);
  await del("handover_task", `DELETE FROM handover_task WHERE task_id = ANY($1::int[])`, [tsk]);
  await del("task_artifact", `DELETE FROM task_artifact WHERE task_id = ANY($1::int[])`, [tsk]);
  await del("task_comment",  `DELETE FROM task_comment  WHERE task_id = ANY($1::int[])`, [tsk]);
  await del("activity_log",  `DELETE FROM activity_log  WHERE task_id = ANY($1::int[])`, [tsk]);
  await del("signal.task_id 해제", `UPDATE signal SET task_id = NULL WHERE task_id = ANY($1::int[])`, [tsk]);
  // 자기참조 먼저 끊는다 — 안 끊으면 삭제 순서에 걸린다(하위·차단 가드 포함)
  await del("task.blocked_by 해제",     `UPDATE task SET blocked_by = NULL     WHERE blocked_by = ANY($1::int[])`, [tsk]);
  await del("task.parent_task_id 해제", `UPDATE task SET parent_task_id = NULL WHERE parent_task_id = ANY($1::int[])`, [tsk]);
  await del("task", `DELETE FROM task WHERE id = ANY($1::int[])`, [tsk]);

  console.log("\n③ 목표 7건 — 연결 해제 → 하위 → 상위");
  await del("goal_snapshot", `DELETE FROM goal_snapshot WHERE goal_id = ANY($1::int[])`, [gol]);
  await del("goal_task",     `DELETE FROM goal_task     WHERE goal_id = ANY($1::int[])`, [gol]);
  await del("project.goal_id 해제", `UPDATE project SET goal_id = NULL WHERE goal_id = ANY($1::int[])`, [gol]);
  // 하위 목표부터 — parent_id 자기참조
  await del("goal(하위)", `DELETE FROM goal WHERE id = ANY($1::int[]) AND parent_id IS NOT NULL`, [gol]);
  await del("goal(상위)", `DELETE FROM goal WHERE id = ANY($1::int[])`, [gol]);

  const left = {
    signal: await n(`SELECT count(*)::text AS n FROM signal WHERE is_demo = true`),
    task:   await n(`SELECT count(*)::text AS n FROM task   WHERE is_demo = true`),
    goal:   await n(`SELECT count(*)::text AS n FROM goal   WHERE is_demo = true`),
  };
  console.log(`\n남은 데모 행 — 시그널 ${left.signal} · 업무 ${left.task} · 목표 ${left.goal}`);

  if (APPLY) {
    await c.query("COMMIT");
    console.log("\n✅ COMMIT — 삭제 완료. 목표 진척 재계산을 이어서 실행하세요.");
  } else {
    await c.query("ROLLBACK");
    console.log("\n↩︎ ROLLBACK — 드라이런이라 아무것도 지우지 않았습니다. 실행하려면 --apply");
  }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("\n❌ 중단 — 전부 되돌렸습니다:", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
