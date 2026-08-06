// MD-P-2026-024 회신 — 지시 5(8월 월 목표 정리) · 지시 6(기한 없는 업무 4건).
//
// API를 통해 실행한다. SQL 직접 수정이 아니라 앱과 같은 경로를 타야
// 활동 로그·목표 재계산·상속 전파가 실제 사용과 동일하게 일어난다.
//
//   BASE=http://127.0.0.1:3000 SESSION=<tb_session 쿠키값> node scripts/md024-data-ops.mjs [--apply]
//
// --apply 없이 실행하면 대상만 세어 보여주고 아무것도 바꾸지 않는다(드라이런).
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const APPLY = process.argv.includes("--apply");
const H = { cookie: `tb_session=${process.env.SESSION}`, "content-type": "application/json" };
const api = async (m, u, b) => {
  const r = await fetch(BASE + u, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${m} ${u} → ${r.status} ${JSON.stringify(d)}`);
  return d;
};
const pool = new pg.Pool({ connectionString: fs.readFileSync(".env.local", "utf8").match(/postgres[^\s"']+/)[0] });
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

const AUG = { start: "2026-08-01", end: "2026-08-31", parent: 11 };
const PLAN = [
  { title: "8월 — EDUINO AI 커리큘럼 2차 완성", projectId: 1 },
  { title: "8월 — Playino 엔진 코어 계약 확정",  projectId: 2 },
  { title: "8월 — AI 학습추론모델 이관·검증",    projectId: 3 },
];
const UNDATED = [80, 89, 96, 102];

async function snapshot(tag) {
  const goals = await q(`SELECT id, left(title,32) AS title, period_type, progress::text AS progress
                           FROM goal WHERE is_active = true ORDER BY id`);
  const links = await q(`SELECT id, name, goal_id FROM project WHERE is_active = true ORDER BY id`);
  const src = await q(`SELECT goal_source, count(*)::text AS n FROM task
                        WHERE project_id IN (1,2,3) AND is_active = true GROUP BY 1 ORDER BY 1`);
  console.log(`\n── [${tag}]`);
  console.log("  목표      " + goals.map((g) => `#${g.id}(${g.period_type[0]})=${g.progress ?? "—"}`).join("  "));
  console.log("  프로젝트  " + links.map((p) => `#${p.id}→goal${p.goal_id ?? "—"}`).join("  "));
  console.log("  goal_source " + src.map((r) => `${r.goal_source}:${r.n}`).join(" "));
  return { goals, links };
}

await snapshot("실행 전");

// ── 지시 6 — 기한 없는 업무 4건
const undated = await q(
  `SELECT id, left(title,34) AS title, due_date::text FROM task WHERE id = ANY($1::int[])`, [UNDATED]
);
console.log(`\n[지시 6] 기한 지정 대상 ${undated.length}건 (기대 4건)`);
for (const t of undated) console.log(`   #${t.id} ${t.title}  현재기한=${t.due_date ?? "없음"}`);
if (undated.length !== UNDATED.length) throw new Error("대상 건수 불일치 — 중단");

if (APPLY) {
  for (const id of UNDATED) await api("PUT", `/api/tasks/${id}`, { dueDate: "2026-08-31" });
  console.log("   → 2026-08-31 지정 완료");
}

// ── 지시 5-1 · 5-2 — 8월 목표 생성 + 프로젝트 이관
console.log(`\n[지시 5] 8월 팀 월 목표 ${PLAN.length}건 생성 + 프로젝트 이관`);
const existing = await q(
  `SELECT id, title FROM goal WHERE is_active = true AND period_type='month'
     AND period_start = $1::date AND scope='team'`, [AUG.start]
);
console.log(`   기존 8월 팀 월 목표: ${existing.length}건 ${existing.map((g) => `#${g.id}`).join(",")}`);

if (APPLY) {
  for (const p of PLAN) {
    if (existing.some((g) => g.title === p.title)) { console.log(`   건너뜀(이미 있음): ${p.title}`); continue; }
    const created = await api("POST", "/api/goals", {
      title: p.title, periodType: "month", periodStart: AUG.start, periodEnd: AUG.end,
      parentId: AUG.parent, scope: "team",
    });
    const gid = created.id ?? created.goal?.id;
    // 연결 엔드포인트를 쓴다 — 이전 목표 재계산 + inherited 업무 전파가 여기 들어 있다.
    await api("POST", `/api/goals/${gid}/projects`, { projectIds: [p.projectId] });
    console.log(`   생성 #${gid} ← 프로젝트 ${p.projectId} 연결 · ${p.title}`);
  }
}

await snapshot(APPLY ? "실행 후" : "드라이런(무변경)");
await pool.end();
