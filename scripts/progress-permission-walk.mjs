// 진척 수동 편집 권한 검사 (MD-P-2026-033 §B).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32). 만진 것은 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 순수 함수 판정 — 지정된 사람만 · 아무도 지정 안 했으면 아무도 못 바꾼다
//   ② 하위가 있으면 **지정된 사람도** 못 바꾼다 (권한이 아니라 규칙이다)
//   ③ 두 이유를 **구분해서** 낸다 (뭉뚱그리면 권한 받은 사람이 설정을 뒤진다)
//   ④ **API 가 실제로 막는가** — 함수가 맞다고 API 도 맞는 것은 아니다
//   ⑤ 지정된 사람은 **실제로 저장된다** (짝이 되는 단언 — 전부 막으면 ④도 참이다)
//   ⑥ `status:"done"` 으로 100 이 되는 길은 **막히지 않는다** (다른 규칙이다)
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("progress-permission-walk.mjs");

const REPO = process.cwd();
const OUT = path.join(REPO, ".pp-walk-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const TITLE = "[검사] 진척 권한";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};
const patch = (id, user, body) => fetch(`${BASE}/api/tasks/${id}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", cookie: `tb_session=${tok(user)}` },
  body: JSON.stringify(body),
});

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`OK   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

let madeIds = [];
let hadEditor;
try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "progress-permission.ts"), "--outDir", OUT,
     "--module", "commonjs", "--moduleResolution", "node", "--target", "es2022",
     "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
  const req = createRequire(path.join(OUT, "noop.cjs"));
  const { canEditProgress } = req(path.join(OUT, "progress-permission.js"));

  // ── ①②③ 순수 함수 ─────────────────────────────────────────────
  ok("① 지정된 사람은 바꿀 수 있다", canEditProgress(1, 1).canEdit === true);
  ok("① 다른 사람은 못 바꾼다", canEditProgress(2, 1).canEdit === false,
     canEditProgress(2, 1).message);
  ok("① 아무도 지정 안 했으면 **아무도** 못 바꾼다 (열지 않는다)",
     canEditProgress(1, null).canEdit === false, canEditProgress(1, null).message);
  const child = canEditProgress(1, 1, { childCount: 2 });
  ok("② 하위가 있으면 지정된 사람도 못 바꾼다", child.canEdit === false, child.message);
  ok("③ 두 이유를 구분해서 낸다",
     child.reason === "auto-from-children" && canEditProgress(2, 1).reason === "not-editor",
     `${child.reason} / ${canEditProgress(2, 1).reason}`);

  // ── 실제 API ────────────────────────────────────────────────────
  const people = await sql(
    `SELECT a.id, a.display_name FROM actor a JOIN account c ON c.actor_id = a.id
      WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 2`);
  if (people.length < 2) throw new Error("사람 계정이 둘 이상 필요하다");
  const [editor, other] = people;
  const area = await one(`SELECT id FROM area WHERE kind='workspace' AND is_active ORDER BY sort_order LIMIT 1`);
  const proj = await one(`SELECT id FROM project WHERE area_id=$1 AND is_active LIMIT 1`, [area.id]);

  // 원래 설정을 기억했다 되돌린다 — 검사가 프로덕션 설정을 바꿔 놓고 가면 안 된다.
  hadEditor = await one(`SELECT value FROM config WHERE key='progress_editor_actor_id'`);
  await sql(`INSERT INTO config (key, value) VALUES ('progress_editor_actor_id', to_jsonb($1::int))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [editor.id]);

  const parent = await one(
    `INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, project_id, is_demo)
     VALUES ($1, 'todo', 10, $2, $2, 'team', $3, $4, true) RETURNING id`,
    [`${TITLE} 부모`, editor.id, area.id, proj?.id ?? null]);
  madeIds.push(parent.id);
  const plain = await one(
    `INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, project_id, is_demo)
     VALUES ($1, 'todo', 10, $2, $2, 'team', $3, $4, true) RETURNING id`,
    [`${TITLE} 단독`, editor.id, area.id, proj?.id ?? null]);
  madeIds.push(plain.id);
  const kid = await one(
    `INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, project_id, parent_task_id, is_demo)
     VALUES ($1, 'todo', 0, $2, $2, 'team', $3, $4, $5, true) RETURNING id`,
    [`${TITLE} 하위`, editor.id, area.id, proj?.id ?? null, parent.id]);
  madeIds.push(kid.id);

  // ── ④ 지정 안 된 사람은 403 ─────────────────────────────────────
  const r1 = await patch(plain.id, { id: other.id, name: other.display_name, role: "lead" }, { progress: 77 });
  const b1 = await r1.json().catch(() => ({}));
  const after1 = await one(`SELECT progress FROM task WHERE id=$1`, [plain.id]);
  ok("④ 지정 안 된 사람은 403 이다", r1.status === 403, `${r1.status} · ${b1.error ?? ""}`);
  // 「403 이 왔다」와 「안 바뀌었다」는 다르다. 값도 본다.
  ok("④ 그리고 값이 **안 바뀌었다**", after1.progress === 10, `progress ${after1.progress} (10 이어야)`);
  ok("④ 팀장이어도 못 바꾼다 (역할과 무관한 규칙이다)", r1.status === 403,
     `${other.display_name} 을 lead 로 보냈는데 ${r1.status}`);

  // ── ⑤ 지정된 사람은 실제로 저장된다 (짝) ────────────────────────
  const r2 = await patch(plain.id, { id: editor.id, name: editor.display_name, role: "member" }, { progress: 77 });
  const after2 = await one(`SELECT progress FROM task WHERE id=$1`, [plain.id]);
  ok("⑤ 지정된 사람은 저장된다", r2.ok && after2.progress === 77,
     `${r2.status} · progress ${after2.progress}`);

  // ── ② 하위가 있는 부모는 지정된 사람도 400 ──────────────────────
  const r3 = await patch(parent.id, { id: editor.id, name: editor.display_name, role: "member" }, { progress: 55 });
  const b3 = await r3.json().catch(() => ({}));
  const after3 = await one(`SELECT progress FROM task WHERE id=$1`, [parent.id]);
  ok("⑨-① 하위가 둘 다 유효하면 지정된 사람도 막힌다 (안 깨졌다)", r3.status === 400,
     `${r3.status} · ${b3.error ?? ""}`);
  ok("② 이유가 권한이 아니라 **규칙**으로 온다", b3.reason === "auto-from-children", `reason ${b3.reason}`);
  ok("② 값도 안 바뀌었다", after3.progress === 10, `progress ${after3.progress}`);

  // ── ⑨ 판정은 **계산이 보는 값**을 본다 (MD-P-2026-036 §B) ────────
  //
  // 계산은 `child_counted`(집계 대상)를, 판정은 `child_count`(전체)를 보고 있었다.
  // 그래서 **하위가 전부 취소·중복인 업무**가 이런 상태였다 —
  // 진척은 자기 값인데 「하위로 계산된다」며 막혔다. 막는 이유가 사실이 아니었다.
  //
  // ①이 그대로인지가 「안 깨졌다」의 증거이고, ②가 이번에 고친 자리다.
  const dead = await one(
    `INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, project_id, is_demo)
     VALUES ($1, 'doing', 33, $2, $2, 'team', $3, $4, true) RETURNING id`,
    [`${TITLE} 죽은하위`, editor.id, area.id, proj?.id ?? null]);
  madeIds.push(dead.id);
  for (const r of ["canceled", "duplicate"]) {
    const k = await one(
      `INSERT INTO task (title, status, progress, resolution, created_by, assignee_id, work_type, area_id, project_id, parent_task_id, is_demo)
       VALUES ($1, 'done', 0, $2, $3, $3, 'team', $4, $5, $6, true) RETURNING id`,
      [`${TITLE} 죽은하위 ${r}`, r, editor.id, area.id, proj?.id ?? null, dead.id]);
    madeIds.push(k.id);
  }
  const counts = await one(
    `SELECT (SELECT count(*)::int FROM task c WHERE c.parent_task_id = $1 AND c.is_active) AS 전체,
            (SELECT count(*)::int FROM task c WHERE c.parent_task_id = $1 AND ${"c.is_active = true AND c.status <> 'proposed' AND c.status <> 'dropped' AND c.work_type <> 'routine' AND (c.resolution IS NULL OR c.resolution NOT IN ('canceled','duplicate'))"}) AS 집계대상`,
    [dead.id]);
  console.log(`  (조건) 하위 전체 ${counts.전체} · 집계 대상 ${counts.집계대상}`);

  // ② 집계 대상이 0 이면 **바꿀 수 있어야 한다**
  const rDead = await patch(dead.id, { id: editor.id, name: editor.display_name, role: "member" }, { progress: 66 });
  const bDead = await rDead.json().catch(() => ({}));
  const afterDead = await one(`SELECT progress FROM task WHERE id=$1`, [dead.id]);
  ok("⑨-② 하위가 전부 취소·중복이면 바꿀 수 있다", rDead.ok,
     `${rDead.status} ${bDead.error ?? ""}`);
  ok("⑨-② 그리고 값이 **실제로 바뀐다**", afterDead.progress === 66,
     `progress ${afterDead.progress} (66 이어야)`);

  // ③ 그 업무의 진척은 자기 값이고 하위로 계산되지 않는다
  const detail = await (await fetch(`${BASE}/api/tasks/${dead.id}`, {
    headers: { cookie: `tb_session=${tok({ id: editor.id, name: editor.display_name, role: "member" })}` },
  })).json();
  ok("⑨-③ effectiveProgress 가 자기 값이다",
     detail.task?.effectiveProgress === 66, `effectiveProgress ${detail.task?.effectiveProgress}`);
  ok("⑨-③ rolledUpFromChildren 이 false 다",
     detail.task?.rolledUpFromChildren === false,
     `rolledUpFromChildren ${detail.task?.rolledUpFromChildren} · childCount ${detail.task?.childCount} · childCounted ${detail.task?.childCounted}`);

  // ── ⑥ 완료 전환으로 100 이 되는 길은 안 막힌다 ──────────────────
  // 여기까지 막으면 「완료 처리를 한 사람만 할 수 있다」가 되어 버린다 — 다른 규칙이다.
  const r4 = await patch(plain.id, { id: other.id, name: other.display_name, role: "lead" }, { status: "done" });
  const after4 = await one(`SELECT progress, status FROM task WHERE id=$1`, [plain.id]);
  ok("⑥ 완료 전환은 지정 안 된 사람도 할 수 있다 (진척 규칙과 다른 규칙)",
     r4.ok && after4.status === "done" && after4.progress === 100,
     `${r4.status} · ${after4.status} · ${after4.progress}%`);

  console.log("");
  console.log(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  rmSync(OUT, { recursive: true, force: true });
  // 만든 것만 지우고, 설정은 **원래대로** 돌린다. 그리고 확인한다.
  try {
    if (madeIds.length) {
      await pool.query(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [madeIds]);
      await pool.query(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [madeIds]);
      await pool.query(`DELETE FROM task WHERE parent_task_id = ANY($1::int[])`, [madeIds]);
      await pool.query(`DELETE FROM task WHERE id = ANY($1::int[])`, [madeIds]);
    }
    if (hadEditor === null) await pool.query(`DELETE FROM config WHERE key='progress_editor_actor_id'`);
    else await pool.query(`UPDATE config SET value=$1 WHERE key='progress_editor_actor_id'`, [hadEditor.value]);
    const left = await one(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${TITLE}%`]);
    const cfg = await one(`SELECT count(*)::int n FROM config WHERE key='progress_editor_actor_id'`);
    console.log(`뒷정리 확인 — [검사] 업무 ${left.n} (0이어야) · 설정 행 ${cfg.n} (원래 ${hadEditor ? 1 : 0})`);
    if (left.n !== 0 || cfg.n !== (hadEditor ? 1 : 0)) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패:", String(e && e.message ? e.message : e));
    process.exitCode = 1;
  }
  await pool.end().catch(() => {});
}
