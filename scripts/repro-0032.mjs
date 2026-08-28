// 0032 리허설 — **「제약이 있다」와 「제약이 막는다」는 다르다** (MD-P-2026-032).
//
// **로컬 전용** (지시 32). **전부 롤백 트랜잭션 안에서 돈다 — 아무것도 남기지 않는다.**
//
// 인덱스를 만들었다는 것만으로는 아무것도 증명되지 않는다. 실제로
//   · 같은 영역에 상시를 하나 더 넣으면 **거부되는가**
//   · 다른 영역에는 **들어가는가** (무조건 막으면 그것도 결함이다)
//   · `goal` 프로젝트는 같은 영역에 여럿이 **여전히 되는가** (부분 조건이 사는가)
//   · **중복이 있으면 인덱스 생성이 실패하는가** — 사전 확인이 형식이 아니었음의 증거
//   · 두 번 돌려도 되는가 (`IF NOT EXISTS`)
//
// 마지막 항목이 특히 중요하다. PM 이 프로덕션에서 「0행」을 확인하고 왔는데,
// 그 확인이 **무엇을 막은 것인지**를 여기서 실제로 보여 준다.
import pg from "pg";
import { readFileSync } from "node:fs";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("repro-0032.mjs");

const FILE = "0032_standing_unique_per_area.sql";
const SQL = readFileSync(`db/migrations/${FILE}`, "utf8");
const IDX = "project_standing_one_per_area";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const q = (t, p = []) => client.query(t, p);

let pass = 0;
let fail = 0;
const L = (s) => console.log(s);
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; L(`OK   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; L(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};
/** 실패해야 하는 쓰기. 성공하면 그것이 결함이다. 저장점으로 트랜잭션을 살린다. */
async function mustReject(label, sql, params = []) {
  await q("SAVEPOINT sp");
  try {
    await q(sql, params);
    await q("ROLLBACK TO SAVEPOINT sp");
    return { rejected: false, msg: "" };
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT sp");
    return { rejected: true, msg: String(e && e.message ? e.message : e) };
  } finally {
    await q("RELEASE SAVEPOINT sp").catch(() => {});
    void label;
  }
}

try {
  await q("BEGIN");

  // ── 적용 전으로 되돌린다 (트랜잭션 안) ──
  await q(`DROP INDEX IF EXISTS ${IDX}`);
  await q(`DELETE FROM schema_migrations WHERE filename = $1`, [FILE]);

  const before = (await q(`SELECT
      (SELECT count(*)::int FROM project WHERE type='standing') AS 상시,
      (SELECT count(*)::int FROM (SELECT area_id FROM project WHERE type='standing'
         GROUP BY area_id HAVING count(*) > 1) x) AS 중복영역`)).rows[0];
  L(`적용 전 — 상시 ${before.상시} · 상시가 2개 이상인 영역 ${before.중복영역}`);
  L(``);

  // ── ⓪ 중복이 있으면 **정말 실패하는가** ─────────────────────────
  // PM 이 프로덕션에서 「0행」을 확인하고 왔다. 그 확인이 무엇을 막은 것인지 본다.
  await q("SAVEPOINT dup");
  const dupArea = (await q(`SELECT area_id FROM project WHERE type='standing' LIMIT 1`)).rows[0].area_id;
  await q(`INSERT INTO project (name, status, color_key, area_id, type, is_active)
           VALUES ('[리허설] 중복 상시', 'active', 'team', $1, 'standing', true)`, [dupArea]);
  let dupErr = null;
  try { await q(SQL); } catch (e) { dupErr = e; }
  ok("⓪ 중복이 있으면 인덱스 생성이 **실패한다** (사전 확인이 형식이 아니었다)",
     dupErr !== null && /duplicate key|unique/i.test(String(dupErr?.message)),
     dupErr ? `“${String(dupErr.message).split("\n")[0]}”` : "**성공했다 — 그러면 중복을 못 막는다는 뜻이다**");
  await q("ROLLBACK TO SAVEPOINT dup");
  await q("RELEASE SAVEPOINT dup");

  // ── ① 적용 ──────────────────────────────────────────────────────
  const t0 = process.hrtime.bigint();
  await q(SQL);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const made = (await q(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [IDX])).rows[0];
  ok("① 인덱스가 생긴다", Boolean(made), `${ms.toFixed(1)}ms · ${made?.indexdef ?? "없음"}`);

  // ── ② 같은 영역에 상시를 하나 더 — **거부되어야 한다** ───────────
  const dup = await mustReject("같은 영역 상시 중복",
    `INSERT INTO project (name, status, color_key, area_id, type, is_active)
     VALUES ('[리허설] 같은 영역 상시', 'active', 'team', $1, 'standing', true)`, [dupArea]);
  ok("② 같은 영역에 상시를 하나 더 넣으면 **거부된다**", dup.rejected,
     dup.rejected ? `“${dup.msg.split("\n")[0]}”` : "**들어갔다 — 인덱스가 막지 못한다**");

  // ── ③ 짝이 되는 단언: 무조건 막으면 그것도 결함이다 ──────────────
  // 상시가 아직 없는 영역을 만들어 거기에는 들어가는지 본다.
  const freeArea = (await q(
    `INSERT INTO area (name, color_key, sort_order, kind, is_active)
     VALUES ('[리허설] 새 영역', 'team', 999, 'workspace', true) RETURNING id`)).rows[0].id;
  let newOk = true;
  let newErr = "";
  try {
    await q(`INSERT INTO project (name, status, color_key, area_id, type, is_active)
             VALUES ('[리허설] 새 영역 상시', 'active', 'team', $1, 'standing', true)`, [freeArea]);
  } catch (e) { newOk = false; newErr = String(e && e.message ? e.message : e); }
  ok("③ 상시가 없는 영역에는 **들어간다** (무조건 막는 것이 아니다)", newOk, newErr || "삽입됨");

  // ── ④ 부분 조건이 사는가 — goal 은 같은 영역에 여럿 ─────────────
  let goalOk = true;
  let goalErr = "";
  try {
    for (let i = 0; i < 2; i++) {
      await q(`INSERT INTO project (name, status, color_key, area_id, type, is_active)
               VALUES ($2, 'active', 'team', $1, 'goal', true)`, [dupArea, `[리허설] goal ${i}`]);
    }
  } catch (e) { goalOk = false; goalErr = String(e && e.message ? e.message : e); }
  ok("④ goal 프로젝트는 같은 영역에 **여럿 된다** (WHERE type='standing' 이 산다)",
     goalOk, goalErr || "같은 영역에 goal 2개 삽입됨");

  // ── ⑤ 두 번 돌려도 되는가 ───────────────────────────────────────
  let againErr = null;
  try { await q(SQL); } catch (e) { againErr = e; }
  ok("⑤ 재실행해도 오류가 없다 (IF NOT EXISTS)", againErr === null,
     againErr ? String(againErr.message) : "두 번째도 조용히 지나간다");

  L(``);
  L(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error("리허설 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await q("ROLLBACK").catch(() => {});
  // 롤백이 정말 되돌렸는지 확인한다 — 리허설도 확인 없이는 증거가 아니다.
  const back = (await q(`SELECT
      (SELECT count(*)::int FROM project WHERE name LIKE '[리허설]%') AS 리허설프로젝트,
      (SELECT count(*)::int FROM area WHERE name LIKE '[리허설]%') AS 리허설영역,
      (SELECT count(*)::int FROM pg_indexes WHERE indexname = '${IDX}') AS 인덱스`)).rows[0];
  console.log(
    `\n롤백 확인 — [리허설] 프로젝트 ${back.리허설프로젝트} · 영역 ${back.리허설영역} · ` +
    `${IDX} ${back.인덱스} (셋 다 0이어야 한다)`
  );
  if (back.리허설프로젝트 || back.리허설영역 || back.인덱스) process.exitCode = 1;
  client.release();
  await pool.end().catch(() => {});
}
