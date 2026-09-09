// 0034 리허설 — 정체와 권한을 가른다 (`admin_grant` 컬럼 추가 · MD-P-2026-039 §A).
//
// **로컬 전용** (지시 32). **전부 롤백 트랜잭션 안에서 돈다 — 아무것도 남기지 않는다.**
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 적용 후 컬럼이 생긴다 (타입 boolean · NOT NULL · DEFAULT false)
//   ② 기존 행이 전부 false 로 들어온다 — **이 파일은 아무에게도 권한을 주지 않는다**
//   ③ true 로 켜진다 (컬럼이 있다 ≠ 값이 들어간다)
//   ④ 되돌리기가 **켜 둔 권한을 정말 날린다** — 머리말에 적은 경고를 자취로 확인한다
//   ⑤ 컬럼이 **없는 동안에도 로그인 조회가 돈다** (B-29 §5)
//   ⑥ 왕복 3회: 적용 → 롤백 → 재적용 → 롤백 → 재적용
//      각 단계에서 행 수·역할 분포를 **되돌린 직후 값과 대조한다**
//
// ④가 왜 검사인가 — 되돌리기 파일에 「권한을 통째로 날립니다」라고 **적어 두었다.**
// 적어 둔 것은 확인이 아니다. 정말 날아가는지 재 본다(§G — 글이 아니라 자취).
//
// ⑤가 왜 여기 있는가 — 0031 때 마이그레이션 하나가 실패하자 팀 전원이 로그인
// 조차 못 했다. 그래서 로그인 조회에 §5 예외를 뒀다. 그런데 그 조회에
// `ac.admin_grant` 를 그냥 적으면 **0034 가 안 끝난 순간 로그인이 다시 죽는다.**
// 예외를 뚫어 놓고 그 옆으로 같은 구멍을 내는 셈이다. 그래서 로그인 조회는
// 컬럼이 없어도 던지지 않는 모양으로 쓰고, 그 모양을 **lib/auth.ts 에서 그대로
// 읽어다** 컬럼 없는 상태에 대고 돌려 본다 — 검사기가 사본을 들면 사본만 맞는다.
//
// ⑥은 절대값을 쓰지 않는다 — 승격된 §G:
// **롤백·뒷정리 확인은 절대값이 아니라 시작 전 상태와 대조한다.**
// 그리고 「시작 전」이 **두 개**다 (0033 에서 겪은 그대로):
//   · 루프 안 왕복   → 되돌린 직후
//   · finally 뒷정리 → 검사기를 돌리기 전
import pg from "pg";
import { readFileSync } from "node:fs";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("repro-0034.mjs");

const FILE = "0034_account_admin_grant.sql";
const UP = readFileSync(`db/migrations/${FILE}`, "utf8");
const DOWN = readFileSync("db/migrations/rollback/0034_account_admin_grant_down.sql", "utf8");
const COL = "admin_grant";

// 로그인 조회가 쓰는 **바로 그 식**을 제품에서 읽어 온다. 여기에 사본을 적으면
// 사본만 맞고 제품은 틀릴 수 있다 — 그러면 이 검사는 아무것도 안 지킨다.
const AUTH_SRC = readFileSync("lib/auth.ts", "utf8");
const GRANT_SQL = AUTH_SRC.match(/ADMIN_GRANT_SQL\s*=\s*`([^`]+)`/)?.[1]?.trim() ?? null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const q = (t, p = []) => client.query(t, p);

let pass = 0, fail = 0;
const L = (s) => console.log(s);
const ok = (n, c, d = "") => {
  if (c) { pass++; L(`OK   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; L(`FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

/** 컬럼 정의 한 줄 — 대조용 지문. 없으면 "(없음)". */
const colDef = async () => {
  const r = (await q(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'account' AND column_name = $1`, [COL])).rows[0];
  return r ? `${r.data_type} · null=${r.is_nullable} · default=${r.column_default}` : "(없음)";
};

/** 행 수 · 역할 분포. 컬럼 유무와 무관하게 읽혀야 하므로 grant 는 안 섞는다. */
const shape = async () => {
  const n = (await q(`SELECT count(*)::int n FROM account`)).rows[0].n;
  const dist = (await q(`SELECT role, count(*)::int n FROM account GROUP BY role ORDER BY role`)).rows
    .map((x) => `${x.role}:${x.n}`).join(" ");
  return `행 ${n} · ${dist}`;
};

let defBefore = null, shapeBefore = null;
try {
  defBefore = await colDef();
  shapeBefore = await shape();
  L(`시작 전 — ${shapeBefore}`);
  L(`시작 전 컬럼 — ${defBefore}`);
  L(``);

  await q("BEGIN");
  await q(DOWN);                       // 로컬에 이미 적용돼 있을 수 있다
  await q(`DELETE FROM schema_migrations WHERE filename = $1`, [FILE]);

  const defDown = await colDef();      // ← 루프 안 왕복이 돌아가야 할 곳
  const shapeDown = await shape();
  ok("⑤-0 되돌린 뒤엔 컬럼이 정말 없다 (④⑤가 뜻을 가지려면 먼저 이것)",
     defDown === "(없음)", defDown);

  // ── ⑤ 컬럼이 없는 동안에도 로그인 조회가 돈다 ────────────────────
  //
  // 조건을 관측보다 먼저 만들었다(§G) — 위에서 컬럼을 지웠고, 지워진 것을
  // 값으로 확인했다. 그 위에서 제품의 식을 돌린다.
  ok("⑤-1 로그인 조회식을 lib/auth.ts 에서 찾았다", GRANT_SQL !== null,
     GRANT_SQL ?? "**ADMIN_GRANT_SQL 을 못 찾음 — 이름이 바뀌었는가**");
  if (GRANT_SQL) {
    let err = null, val;
    try {
      val = (await q(`SELECT ${GRANT_SQL} FROM account ac LIMIT 1`)).rows[0];
    } catch (e) { err = e; }
    ok("⑤-2 컬럼이 없어도 로그인 조회가 던지지 않는다 (B-29 §5)",
       err === null,
       err ? `**던졌다: ${String(err.message).split("\n")[0]}**`
           : `값 ${JSON.stringify(val)} — 없으면 null, 즉 권한 없음으로 읽힌다`);
  }

  // ── ⑥ 왕복 3회 ──────────────────────────────────────────────────
  for (let round = 1; round <= 3; round += 1) {
    await q(UP);
    const def = await colDef();
    const shp = await shape();

    if (round === 1) {
      ok("① 적용 후 컬럼이 생긴다 (boolean · NOT NULL · DEFAULT false)",
         def.startsWith("boolean") && def.includes("null=NO") && def.includes("default=false"),
         def);

      // ② 기존 행이 전부 false. **이 파일은 아무에게도 권한을 주지 않는다.**
      const on = (await q(`SELECT count(*)::int n FROM account WHERE ${COL} = true`)).rows[0].n;
      const all = (await q(`SELECT count(*)::int n FROM account`)).rows[0].n;
      ok("② 기존 행이 전부 권한 없음으로 들어온다", on === 0,
         `권한 켜진 계정 ${on} / 전체 ${all} (0이어야 한다)`);

      // ③ 컬럼이 있다 ≠ 값이 들어간다. 넣어 보지 않으면 모른다.
      await q("SAVEPOINT g");
      const target = (await q(`SELECT actor_id FROM account ORDER BY actor_id LIMIT 1`)).rows[0]?.actor_id;
      let insErr = null, after = null;
      try {
        await q(`UPDATE account SET ${COL} = true WHERE actor_id = $1`, [target]);
        after = (await q(`SELECT ${COL} FROM account WHERE actor_id = $1`, [target])).rows[0][COL];
      } catch (e) { insErr = e; }
      ok("③ true 로 켜진다", insErr === null && after === true,
         insErr ? String(insErr.message).split("\n")[0] : `actor#${target} → ${after}`);

      // ④ 되돌리기가 **켜 둔 권한을 정말 날린다.** 켜 둔 채로 내렸다 다시 올린다.
      //   (지금 target 의 권한이 켜져 있다 — 조건을 관측보다 먼저 만들었다)
      await q(DOWN);
      await q(UP);
      const revived = (await q(`SELECT ${COL} FROM account WHERE actor_id = $1`, [target])).rows[0][COL];
      ok("④ 되돌렸다 다시 올리면 켜 둔 권한이 사라진다 (머리말 경고가 참이다)",
         revived === false, `actor#${target} 권한 ${revived} (false 여야 한다 — 켜 두었었다)`);
      await q("ROLLBACK TO SAVEPOINT g");
      await q("RELEASE SAVEPOINT g");
    }

    ok(`⑥-${round} 적용 후 행 수·분포가 그대로다`, shp === shapeDown,
       `${shp} (되돌린 직후 ${shapeDown})`);

    if (round < 3) {
      await q(DOWN);
      const backDef = await colDef();
      const backShape = await shape();
      ok(`⑥-${round} 롤백 후 컬럼이 되돌린 직후와 같다`, backDef === defDown,
         backDef === defDown ? "동일 (없음)" : `${backDef} vs ${defDown}`);
      ok(`⑥-${round} 롤백 후 행 수·분포가 그대로다`, backShape === shapeDown,
         `${backShape} (되돌린 직후 ${shapeDown})`);
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
  // 되돌아왔는지 — **검사기를 돌리기 전 상태와 대조한다.** 절대값이 아니다.
  const def = await colDef().catch(() => "(못 읽음)");
  const shp = await shape().catch(() => "(못 읽음)");
  console.log(`\n롤백 확인 — ${shp} (시작 전 ${shapeBefore})`);
  console.log(`           컬럼 ${def === defBefore ? `시작 전과 같음 (${def})` : `**다름** ${def} vs ${defBefore}`}`);
  if (shp !== shapeBefore || def !== defBefore) process.exitCode = 1;
  client.release();
  await pool.end().catch(() => {});
}
