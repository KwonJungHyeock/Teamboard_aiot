// 0035 리허설 — 최초 관리자 권한 부트스트랩 (MD-P-2026-041 §A).
//
// **로컬 전용** (지시 32). **전부 롤백 트랜잭션 안에서 돈다 — 아무것도 남기지 않는다.**
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 이름이 맞는 DB → **그 계정 하나만** true, 나머지 전부 false (건수로 센다)
//   ② 이름이 **없는** DB → 실패하지 않고 지나가고, 관리자 0명이 **로그에 남는다**
//   ③ 같은 이름의 **agent actor** 가 있어도 그 쪽은 안 켜진다  ← `type` 가드
//   ④ 롤백 후 시작 전 지문과 같다
//   ⑤ 0034 → 0035 → 0034 롤백 → 재적용 순서에서도 안 깨진다
//
// ── 왜 이렇게 재는가 ─────────────────────────────────────────────
//
// ①에서 「하나가 켜졌다」만 보면 **전부 켜진 경우와 구분이 안 된다.** 그래서
// 켜진 수와 안 켜진 수를 같이 센다. 한 값만으로는 「했다」와 「하다가 넘쳤다」가
// 안 갈린다(§G).
//
// ②는 이 파일의 **핵심 성질**이다. 이름이 틀렸을 때의 벌이 서비스 전체 정지여서는
// 안 된다(B-29). 「안 던진다」는 글로 쓰는 것이 아니라 **던지는지 돌려 봐서** 안다
// (§G — 하지 않는다는 자취로 확인한다). 그리고 던지지 않는 대신 로그가 유일한
// 증거이므로, **NOTICE 가 실제로 밖으로 나오는지도** 함께 잰다.
//
// ③은 조건을 관측보다 먼저 만든다 — 같은 이름의 agent actor 에 account 행을
// 붙여 두고 돌린다. 이 상태가 평소에 생기지는 않지만, `type` 가드가 정말
// 일하는지는 그 상태를 만들어야만 알 수 있다.
//
// ④⑤는 절대값을 쓰지 않는다 — 승격된 §G:
// **롤백·뒷정리 확인은 절대값이 아니라 시작 전 상태와 대조한다.**
// 「시작 전」이 두 개다: 루프 안 왕복은 **되돌린 직후**, finally 는 **검사기 돌리기 전**.
import pg from "pg";
import { readFileSync } from "node:fs";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("repro-0035.mjs");

const F34 = "0034_account_admin_grant.sql";
const F35 = "0035_bootstrap_admin_grant.sql";
const UP34 = readFileSync(`db/migrations/${F34}`, "utf8");
const DOWN34 = readFileSync("db/migrations/rollback/0034_account_admin_grant_down.sql", "utf8");
const UP35 = readFileSync(`db/migrations/${F35}`, "utf8");
const DOWN35 = readFileSync("db/migrations/rollback/0035_bootstrap_admin_grant_down.sql", "utf8");

// 켤 사람의 이름은 **마이그레이션 파일에서 읽는다.** 여기 사본을 적으면 사본만
// 맞고 제품은 틀릴 수 있다. 이름이 사는 곳은 그 파일뿐이라는 것도 이걸로 지킨다.
const NAME = UP35.match(/ac\.display_name\s*=\s*'([^']+)'/)?.[1] ?? null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const q = (t, p = []) => client.query(t, p);

// 마이그레이션이 남긴 말을 받는다 — 러너가 하는 것과 같은 방식이다.
let notices = [];
const onNotice = (n) => { if (n?.message) notices.push(n.message); };
client.on("notice", onNotice);
const takeNotices = () => { const n = notices; notices = []; return n; };

let pass = 0, fail = 0;
const L = (s) => console.log(s);
const ok = (n, c, d = "") => {
  if (c) { pass++; L(`OK   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; L(`FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

/** 권한 지문 — 누가 켜져 있는가. 대조용. */
const grants = async () => (await q(
  `SELECT a.actor_id, a.admin_grant FROM account a ORDER BY a.actor_id`)).rows
  .map((r) => `${r.actor_id}:${r.admin_grant ? "T" : "f"}`).join(" ");
/** 켜진 수 · 안 켜진 수 — 한 값만으로는 「하나 켰다」와 「전부 켰다」가 안 갈린다. */
const counts = async () => (await q(
  `SELECT count(*) FILTER (WHERE admin_grant) ::int on_n,
          count(*) FILTER (WHERE NOT admin_grant)::int off_n FROM account`)).rows[0];

let fpBefore = null;
try {
  ok("0-이름을-파일에서-읽었다", NAME !== null, NAME ? `"${NAME}"` : "**못 찾음 — 식이 바뀌었는가**");
  if (!NAME) throw new Error("0035 에서 이름을 못 읽었다");

  fpBefore = await grants();
  L(`시작 전 — 권한 ${fpBefore}`);
  L(``);

  await q("BEGIN");
  // 적용 전으로 되돌린다(트랜잭션 안). 로컬엔 0034 가 이미 적용돼 있다.
  await q(DOWN35);
  await q(DOWN34);
  await q(`DELETE FROM schema_migrations WHERE filename IN ($1, $2)`, [F34, F35]);
  await q(UP34);                         // 컬럼은 있어야 0035 가 뜻을 가진다
  const fpDown = await grants();         // ← 루프 안 왕복이 돌아가야 할 곳
  const cDown = await counts();
  ok("0-조건", cDown.on_n === 0, `되돌린 직후 권한 켜진 계정 ${cDown.on_n} (0이라야 ①이 뜻을 가진다)`);

  // ── ③ 조건을 **먼저** 만든다 — 같은 이름의 agent actor + account 행 ──
  const ghost = (await q(
    `INSERT INTO actor (type, display_name, is_active) VALUES ('agent', $1, true) RETURNING id`,
    [NAME])).rows[0].id;
  await q(`INSERT INTO account (actor_id, email, password_hash, role)
           VALUES ($1, '[리허설]ghost@x.local', 'x', 'member')`, [ghost]);
  L(`   (조건) 같은 이름 "${NAME}" 의 **에이전트** actor#${ghost} 에 계정을 붙였다`);

  // ── ① 적용 ─────────────────────────────────────────────────────
  takeNotices();
  let upErr = null;
  try { await q(UP35); } catch (e) { upErr = e; }
  ok("①-던지지-않는다", upErr === null, upErr ? String(upErr.message).split("\n")[0] : "정상 종료");

  const c1 = await counts();
  const humanOn = (await q(
    `SELECT count(*)::int n FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE a.admin_grant AND ac.type = 'human' AND ac.display_name = $1`, [NAME])).rows[0].n;
  ok("①-그-계정-하나만-켜진다", c1.on_n === 1 && humanOn === 1,
     `켜짐 ${c1.on_n} · 꺼짐 ${c1.off_n} · 그중 이름이 맞는 사람 ${humanOn}`);

  // ③ 짝 — 에이전트 쪽은 안 켜졌는가. `type` 가드가 없으면 여기서 2가 된다.
  const ghostOn = (await q(`SELECT admin_grant FROM account WHERE actor_id = $1`, [ghost])).rows[0].admin_grant;
  ok("③-같은이름-에이전트는-안켜진다", ghostOn === false,
     `agent actor#${ghost} 권한 ${ghostOn} (false 여야 한다 — type 가드)`);

  const n1 = takeNotices();
  ok("①-켠-건수가-로그에-남는다", n1.some((m) => /권한 켠 계정 1건/.test(m)),
     n1.length ? n1.map((m) => `“${m}”`).join(" / ") : "**NOTICE 가 하나도 안 나왔다**");

  // ── ② 이름이 없는 DB ────────────────────────────────────────────
  //
  // 조건을 관측보다 먼저 만든다 — 되돌리고, 사람 쪽 이름을 바꿔 없앤 뒤 돌린다.
  await q(DOWN35);
  await q("SAVEPOINT noname");
  await q(`DELETE FROM account WHERE actor_id = $1`, [ghost]);   // ③의 조건은 여기서 걷는다
  await q(`DELETE FROM actor WHERE id = $1`, [ghost]);
  await q(`UPDATE actor SET display_name = display_name || '(리허설개명)'
            WHERE type = 'human' AND display_name = $1`, [NAME]);
  const gone = (await q(`SELECT count(*)::int n FROM actor WHERE display_name = $1`, [NAME])).rows[0].n;
  ok("②-조건", gone === 0, `"${NAME}" 인 actor ${gone}명 (0이라야 ②가 뜻을 가진다)`);

  takeNotices();
  let noneErr = null;
  try { await q(UP35); } catch (e) { noneErr = e; }
  ok("②-이름이-없어도-안-던진다", noneErr === null,
     noneErr ? `**던졌다: ${String(noneErr.message).split("\n")[0]}**` : "정상 종료 — 전 요청 500 이 되지 않는다");
  const c2 = await counts();
  ok("②-아무것도-안-켜진다", c2.on_n === 0, `켜짐 ${c2.on_n} · 꺼짐 ${c2.off_n}`);
  const n2 = takeNotices();
  ok("②-관리자-0명이-로그에-남는다",
     n2.some((m) => /활성 관리자 0명/.test(m)) && n2.some((m) => /0036/.test(m)),
     n2.length ? n2.map((m) => `“${m}”`).join(" / ") : "**NOTICE 가 하나도 안 나왔다**");

  await q("ROLLBACK TO SAVEPOINT noname");
  await q("RELEASE SAVEPOINT noname");

  // ── ⑤ 0034 를 되돌렸다 다시 올리는 순서에서도 안 깨진다 ──────────
  //
  // 0034 롤백은 **컬럼을 지운다.** 그러니 켜 둔 권한도 함께 사라진다 —
  // 그 뒤 0035 를 다시 돌리면 또 켜져야 한다. 「사라진 뒤 다시 켜진다」가
  // 이 순서에서 확인해야 할 전부다.
  await q(UP35);
  const before5 = (await counts()).on_n;
  await q(DOWN34);
  await q(UP34);
  const mid5 = (await counts()).on_n;
  await q(UP35);
  const after5 = (await counts()).on_n;
  ok("⑤-0034-왕복을-끼워도-복구된다", before5 === 1 && mid5 === 0 && after5 === 1,
     `0035 후 ${before5} → 0034 왕복 후 ${mid5} → 0035 재적용 후 ${after5}`);

  /*
   * ── ④ 롤백 ────────────────────────────────────────────────────
   *
   * **「적용 전」을 여기서 다시 뜬다.** 처음엔 위쪽 `fpDown` 과 비교했다가 FAIL 이
   * 났고, 조사해 보니 **옳은 상태를 결함으로 읽은 것**이었다 — `fpDown` 은 ③의
   * 조건(같은 이름의 에이전트 계정)을 만들기 **전** 지문인데, ④ 시점에는 그
   * 계정이 있다. 0033 에서 겪은 것과 같은 실수다.
   *
   * 그래서 ④는 자기 경계를 스스로 잡는다: **바로 직전 상태 → 적용 → 롤백 →
   * 직전 상태와 대조.** 멀리 있는 지문을 끌어다 쓰지 않는다.
   */
  await q(DOWN35);
  const fpPre = await grants();
  await q(UP35);
  const fpOn = await grants();
  await q(DOWN35);
  const fpBack = await grants();
  ok("④-0035-롤백-후-적용전과-같다", fpBack === fpPre && fpOn !== fpPre,
     fpBack === fpPre
       ? `적용 ${fpOn} → 롤백 ${fpBack} (적용 전 ${fpPre})`
       : `**다름** ${fpBack} vs ${fpPre}`);

  L(``);
  L(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error("리허설 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await q("ROLLBACK").catch(() => {});
  // **검사기를 돌리기 전** 상태와 대조한다. 절대값이 아니다.
  const fpAfter = await grants().catch(() => "(못 읽음)");
  const left = (await q(
    `SELECT count(*)::int n FROM account WHERE email LIKE '[리허설]%'`
  ).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
  console.log(`\n롤백 확인 — 권한 ${fpAfter === fpBefore ? `시작 전과 같음 (${fpAfter})` : `**다름** ${fpAfter} vs ${fpBefore}`}`);
  console.log(`           리허설 잔여 계정 ${left} (0이어야 한다)`);
  if (fpAfter !== fpBefore || left !== 0) process.exitCode = 1;
  client.off("notice", onNotice);
  client.release();
  await pool.end().catch(() => {});
}
