// 0033 리허설 — 역할 값 목록에 `admin` 을 더한다 (MD-P-2026-035 §B-1).
//
// **로컬 전용** (지시 32). **전부 롤백 트랜잭션 안에서 돈다 — 아무것도 남기지 않는다.**
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 적용 후 CHECK 에 `admin` 이 들어간다
//   ② `role='admin'` 이 실제로 **들어간다** (제약이 있다 ≠ 제약이 통과시킨다)
//   ③ `role='ghost'` 는 **여전히 거부된다** — 넓히다 뚫리지 않았는가
//   ④ 왕복 3회: 적용 → 롤백 → 재적용 → 롤백 → 재적용
//      각 단계에서 행 수와 역할 분포를 **시작 전 값과 대조한다**
//
// ③이 없으면 ①②는 「CHECK 를 아예 지웠다」와 구분이 안 된다. 지우면 ①은 거짓이
// 되지만 ②는 참이 되고, 화면상으로는 성공처럼 보인다.
//
// ④는 절대값을 쓰지 않는다 — 승격된 §G:
// **롤백·뒷정리 확인은 절대값이 아니라 시작 전 상태와 대조한다.**
import pg from "pg";
import { readFileSync } from "node:fs";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("repro-0033.mjs");

const FILE = "0033_account_role_admin.sql";
const UP = readFileSync(`db/migrations/${FILE}`, "utf8");
const DOWN = readFileSync("db/migrations/rollback/0033_account_role_admin_down.sql", "utf8");
const CON = "account_role_check";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const q = (t, p = []) => client.query(t, p);

let pass = 0, fail = 0;
const L = (s) => console.log(s);
const ok = (n, c, d = "") => {
  if (c) { pass++; L(`OK   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; L(`FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

const checkDef = async () =>
  (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
             WHERE conrelid='account'::regclass AND conname=$1`, [CON])).rows[0]?.d ?? "(없음)";

/** 행 수 · 역할 분포를 한 줄로 — 대조용 지문. */
const shape = async () => {
  const r = (await q(`SELECT count(*)::int n FROM account`)).rows[0].n;
  const dist = (await q(`SELECT role, count(*)::int n FROM account GROUP BY role ORDER BY role`)).rows
    .map((x) => `${x.role}:${x.n}`).join(" ");
  return `행 ${r} · ${dist}`;
};

/** 실패해야 하는 쓰기. 성공하면 그것이 결함이다. */
async function mustReject(sql, params = []) {
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
  }
}

// `finally` 에서도 봐야 하므로 try 밖에 둔다.
let defBefore = null, shapeBefore = null;
try {
  defBefore = await checkDef();
  shapeBefore = await shape();
  L(`시작 전 — ${shapeBefore}`);
  L(`시작 전 CHECK — ${defBefore}`);
  L(``);

  await q("BEGIN");
  // 적용 전으로 되돌린다 (트랜잭션 안). 로컬에 이미 적용돼 있을 수 있다.
  await q(DOWN);
  await q(`DELETE FROM schema_migrations WHERE filename = $1`, [FILE]);

  /*
   * ── 「시작 전」이 **두 개**다. 헷갈리면 옳은 상태를 결함으로 읽는다 ──
   *
   * `defBefore` 는 **트랜잭션 밖** — 이 검사기를 돌리기 전의 진짜 DB 상태다.
   * 로컬에 0033 이 이미 적용돼 있으면 여기엔 `admin` 이 들어 있다.
   *
   * 그런데 왕복 검증은 트랜잭션 안에서 **적용 전으로 되돌린 뒤** 시작한다.
   * 그러니 루프 안의 「롤백 후」가 돌아가야 할 곳은 `defBefore` 가 아니라
   * **바로 이 시점**이다. 둘을 같은 것으로 보다가 FAIL 이 났다 —
   * 실제로 그렇게 났고, 옳은 상태였다.
   *
   * 승격된 §G(「절대값이 아니라 시작 전 상태와 대조한다」)를 적용할 때
   * **「시작 전」이 어느 경계인지**를 함께 정해야 한다.
   *   · 루프 안 왕복  → `defDown` (되돌린 직후)
   *   · finally 뒷정리 → `defBefore` (검사기를 돌리기 전)
   */
  const defDown = await checkDef();
  const shapeDown = await shape();

  // ── 왕복 3회 ────────────────────────────────────────────────────
  for (let round = 1; round <= 3; round += 1) {
    await q(UP);
    const def = await checkDef();
    const shp = await shape();

    if (round === 1) {
      ok("① 적용 후 CHECK 에 admin 이 들어간다", def.includes("'admin'"), def);

      // ② 실제로 들어가는가. **넣어 보지 않으면 모른다.**
      await q("SAVEPOINT ins");
      const actor = (await q(
        `INSERT INTO actor (type, display_name, is_active) VALUES ('human','[리허설] 관리자', true) RETURNING id`
      )).rows[0].id;
      let insErr = null;
      try {
        await q(`INSERT INTO account (actor_id, email, password_hash, role)
                 VALUES ($1, '[리허설]admin@x.local', 'x', 'admin')`, [actor]);
      } catch (e) { insErr = e; }
      ok("② role='admin' 이 실제로 들어간다", insErr === null,
         insErr ? String(insErr.message).split("\n")[0] : "삽입됨");

      // ③ 짝 — 넓히다 뚫리지 않았는가. 이게 없으면 ①②는
      //    「CHECK 를 아예 지웠다」와 구분이 안 된다.
      const ghost = await mustReject(
        `INSERT INTO account (actor_id, email, password_hash, role)
         VALUES ($1, '[리허설]ghost@x.local', 'x', 'ghost')`, [actor]);
      ok("③ role='ghost' 는 여전히 거부된다 (뚫리지 않았다)", ghost.rejected,
         ghost.rejected ? `“${ghost.msg.split("\n")[0]}”` : "**들어갔다 — CHECK 가 죽었다**");

      await q("ROLLBACK TO SAVEPOINT ins");
      await q("RELEASE SAVEPOINT ins");
    }

    ok(`④-${round} 적용 후 행 수·분포가 그대로다`, shp === shapeDown,
       `${shp} (적용 전 ${shapeDown})`);

    if (round < 3) {
      await q(DOWN);
      const backDef = await checkDef();
      const backShape = await shape();
      ok(`④-${round} 롤백 후 CHECK 가 적용 전과 같다`, backDef === defDown,
         backDef === defDown ? "동일" : `${backDef} vs ${defDown}`);
      ok(`④-${round} 롤백 후 행 수·분포가 그대로다`, backShape === shapeDown,
         `${backShape} (적용 전 ${shapeDown})`);
    }
  }

  L(``);
  L(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error("리허설 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await q("ROLLBACK").catch(() => {});
  // 롤백이 정말 되돌렸는지 — **시작 전 상태와 대조한다.** 절대값이 아니다.
  const def = await checkDef().catch(() => "(못 읽음)");
  const shp = await shape().catch(() => "(못 읽음)");
  const left = (await q(
    `SELECT count(*)::int n FROM actor WHERE display_name LIKE '[리허설]%'`
  ).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
  console.log(`\n롤백 확인 — ${shp} (시작 전 ${shapeBefore})`);
  console.log(`           CHECK ${def === defBefore ? "시작 전과 같음" : `**다름** ${def}`}`);
  console.log(`           [리허설] actor 잔여 ${left} (0이어야 한다)`);
  if (shp !== shapeBefore || def !== defBefore || left !== 0) process.exitCode = 1;
  client.release();
  await pool.end().catch(() => {});
}
