// 기간과 상위가 어긋난 목표 목록 (MD-P-2026-029 §A6).
//
// **읽기 전용이다. 자동 교정하지 않는다.** 지시서가 명시적으로 금지했다.
// 목록만 내고 판단은 사람이 한다.
//
//   node scripts/goal-parent-audit.mjs
import pg from "pg";

const DSN = process.env.DATABASE_URL;
if (!DSN) { console.error("DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;

const quarterStartOf = (d) => {
  const m = Number(d.slice(5, 7));
  return `${d.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
};
const yearStartOf = (d) => `${d.slice(0, 4)}-01-01`;

try {
  const goals = await sql(`
    SELECT g.id, g.title, g.period_type, g.period_start::text AS period_start,
           g.scope, g.owner_actor_id, g.parent_id,
           p.period_type AS p_type, p.period_start::text AS p_start, p.title AS p_title,
           p.scope AS p_scope, p.owner_actor_id AS p_owner
      FROM goal g LEFT JOIN goal p ON p.id = g.parent_id
     WHERE g.is_active = true
     ORDER BY g.period_type, g.period_start, g.id`);

  const rows = [];
  for (const g of goals) {
    if (g.period_type === "year") continue;                 // 연간은 상위가 없다
    const want = g.period_type === "month"
      ? { type: "quarter", start: quarterStartOf(g.period_start) }
      : { type: "year", start: yearStartOf(g.period_start) };

    // 기간 기준 상위 후보 — 스코프까지 맞아야 한다 (개인은 같은 사람의 개인 목표에만)
    const cand = await sql(
      `SELECT id, title FROM goal
        WHERE is_active = true AND period_type = $1 AND period_start = $2::date AND scope = $3
          AND ($4::int IS NULL OR owner_actor_id = $4)
        ORDER BY id`,
      [want.type, want.start, g.scope, g.scope === "personal" ? g.owner_actor_id : null]);

    let verdict = null;
    if (g.parent_id === null) {
      verdict = cand.length ? "상위 없음 (후보 있음)" : "상위 없음 (후보도 없음)";
    } else if (!cand.some((c) => c.id === g.parent_id)) {
      verdict = "기간과 어긋남";
    }
    if (!verdict) continue;

    rows.push({
      id: g.id, title: g.title, 주기: g.period_type, 기간: g.period_start, 스코프: g.scope,
      현재상위: g.parent_id ? `#${g.parent_id} ${g.p_title} (${g.p_type} ${g.p_start})` : "없음",
      기간기준상위: cand.length ? cand.map((c) => `#${c.id} ${c.title}`).join(" / ") : `없음 (${want.type} ${want.start} 부재)`,
      판정: verdict,
    });
  }

  console.log(`\n── §A6 기간과 상위가 어긋난 목표 — ${rows.length}건 ──`);
  console.log("**자동 교정하지 않았습니다.** 목록만 냅니다.\n");
  if (rows.length === 0) {
    console.log("  어긋난 목표 없음.");
  } else {
    for (const r of rows) {
      console.log(`  #${r.id}  ${r.title}`);
      console.log(`        주기 ${r.주기} · 기간 ${r.기간} · 스코프 ${r.스코프}`);
      console.log(`        현재 상위     ${r.현재상위}`);
      console.log(`        기간 기준 상위  ${r.기간기준상위}`);
      console.log(`        판정          ${r.판정}\n`);
    }
  }
  // 짝이 되는 존재 단언 (지시 28) — "0건"만 세면 조회가 통째로 비어도 통과한다.
  console.log(`검사한 목표 ${goals.length}건 (연간 제외 ${goals.filter((g) => g.period_type !== "year").length}건)`);
} finally {
  await pool.end();
}
