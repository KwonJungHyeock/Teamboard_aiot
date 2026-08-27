// 마이그레이션 러너 검사 (MD-P-2026-032 — 0031 이 빠진 뒤).
//
// **로컬 전용** (지시 32). 이 검사는 `schema_migrations` 에 **실제로 쓴다.**
//
// ── 무엇을 확인하는가 ─────────────────────────────────────────────
//
//   ① 한 파일이 실패하면 **거기서 멈추고 예외를 올린다**
//   ② 실패 뒤 파일을 **건너뛰지 않는다** — 흔적조차 남지 않아야 한다
//   ③ 고치면 **다음 번에 이어서** 간다
//   ④ 밖에서 현황을 물을 수 있고, **묻는 것이 적용을 일으키지 않는다**
//   ⑤ 어느 배포가 적용했는지 이력에 남는다 (`applied_by`)
//   ⑥ 이력에는 있는데 파일이 없는 것도 보인다 (`unknown`)
//
// ── 왜 러너를 흉내내지 않고 진짜를 돌리는가 ───────────────────────
//
// 러너의 동작을 .mjs 로 다시 쓰면 **다시 쓴 것이 맞다는 증거**밖에 안 된다.
// 그래서 `lib/migrate.ts` 를 tsc 로 그대로 컴파일해서 부른다. 러너가
// `process.cwd()/db/migrations` 를 보므로, 임시 디렉터리를 만들고 그리로 옮겨
// **가짜 마이그레이션 9001~9004** 를 넣는다. 진짜 `db/migrations` 는 안 건드린다.
//
//   node scripts/migrate-runner-walk.mjs
import pg from "pg";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("migrate-runner-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(os.tmpdir(), `mrw-${process.pid}`);
const MIG = path.join(TMP, "db", "migrations");
const OUT = path.join(TMP, "out");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;

let pass = 0;
let fail = 0;
const L = (s) => console.log(s);
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; L(`OK   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; L(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

// 가짜 마이그레이션. 번호를 9000번대로 둔다 — 진짜 파일과 절대 섞이지 않는다.
const F1 = "9001_walk_a.sql";
const F2 = "9002_walk_boom.sql";
const F3 = "9003_walk_c.sql";
const F4 = "9004_walk_d.sql";
const WALK_FILES = [F1, F2, F3, F4];

const write = (f, sql) => writeFileSync(path.join(MIG, f), sql);

async function cleanup() {
  // 검사가 만든 것만 지운다. 이름으로 좁힌다.
  await q(`DROP TABLE IF EXISTS tb_walk_a, tb_walk_c, tb_walk_d`);
  await q(`DELETE FROM schema_migrations WHERE filename LIKE '9%_walk_%'`);
  rmSync(TMP, { recursive: true, force: true });
}

try {
  mkdirSync(MIG, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  // ── 진짜 러너를 컴파일한다 ──
  execFileSync(
    path.join(REPO, "node_modules", ".bin", "tsc"),
    [
      path.join(REPO, "lib", "migrate.ts"),
      "--outDir", OUT,
      "--module", "esnext",
      "--moduleResolution", "bundler",
      "--target", "es2022",
      "--skipLibCheck",
    ],
    { stdio: "inherit" }
  );
  // `.js` 를 ESM 으로 읽게 한다 (러너는 node 내장 모듈만 import 한다).
  writeFileSync(path.join(OUT, "package.json"), JSON.stringify({ type: "module" }));

  // 러너는 **모듈을 읽는 시점의 cwd** 로 마이그레이션 경로를 정한다. 먼저 옮긴다.
  process.chdir(TMP);
  const { runMigrations, migrationStatus } = await import(
    path.join(OUT, "migrate.js")
  );

  // 앞선 회차가 남긴 것이 있으면 여기서 지운다 — 검사는 매번 같은 자리에서 시작한다.
  await q(`DROP TABLE IF EXISTS tb_walk_a, tb_walk_c, tb_walk_d`);
  await q(`DELETE FROM schema_migrations WHERE filename LIKE '9%_walk_%'`);

  // ── ①② 실패하면 멈추고, 뒤를 건너뛰지 않는다 ───────────────────
  write(F1, `CREATE TABLE tb_walk_a (id int);`);
  write(F2, `THIS IS NOT SQL;`);
  write(F3, `CREATE TABLE tb_walk_c (id int);`);

  let threw = null;
  try {
    await runMigrations(pool);
  } catch (e) {
    threw = e;
  }
  ok("① 실패한 파일이 있으면 예외를 올린다", threw !== null,
     threw ? `“${String(threw.message).split("\n")[0]}”` : "예외가 없었다");
  ok("① 예외 메시지가 **어느 파일**인지 말한다",
     threw != null && String(threw.message).includes(F2),
     threw ? String(threw.message) : "—");

  const hist1 = (await q(`SELECT filename FROM schema_migrations WHERE filename LIKE '9%_walk_%' ORDER BY filename`))
    .map((r) => r.filename);
  ok("② 실패 앞의 파일만 이력에 남는다",
     hist1.length === 1 && hist1[0] === F1, `이력 [${hist1.join(", ")}]`);

  // 「이력에 없다」만으로는 부족하다 — **손도 안 댔는지**를 본다.
  // 9003 이 돌았다면 표가 생겼을 것이고, 이력만 안 남았을 수도 있다.
  const [{ c3 }] = await q(`SELECT to_regclass('public.tb_walk_c') IS NOT NULL AS c3`);
  ok("② 실패 뒤 파일은 **실행조차 되지 않는다** (표가 안 생겼다)", c3 === false,
     c3 ? "tb_walk_c 가 생겼다 — 건너뛰고 계속 돌았다는 뜻" : "tb_walk_c 없음");

  // ── ⑤ 어느 배포가 적용했는가 ────────────────────────────────────
  const [row1] = await q(`SELECT applied_by FROM schema_migrations WHERE filename = $1`, [F1]);
  ok("⑤ 이력에 적용한 쪽이 남는다", typeof row1?.applied_by === "string" && row1.applied_by.length > 0,
     `applied_by = ${JSON.stringify(row1?.applied_by)}`);

  // ── ③ 고치면 이어서 간다 ────────────────────────────────────────
  write(F2, `SELECT 1;`);
  const r2 = await runMigrations(pool);
  ok("③ 고친 뒤 남은 것만 적용한다",
     JSON.stringify(r2.applied) === JSON.stringify([F2, F3]),
     `applied [${r2.applied.join(", ")}] · 이미 ${r2.alreadyDone}`);
  ok("③ 끝나면 남은 것이 없다", r2.missing.length === 0, `missing [${r2.missing.join(", ")}]`);

  // ── ④ 밖에서 묻는다. 그리고 **묻는 것이 적용을 일으키지 않는다** ─
  write(F4, `CREATE TABLE tb_walk_d (id int);`);
  const st = await migrationStatus(pool);
  ok("④ 파일은 있는데 이력에 없는 것을 짚어낸다",
     st.missing.includes(F4) && st.ok === false,
     `missing [${st.missing.join(", ")}] · ok ${st.ok}`);

  const [{ c4 }] = await q(`SELECT to_regclass('public.tb_walk_d') IS NOT NULL AS c4`);
  ok("④ 물어보기만 했을 뿐 **적용되지 않았다**", c4 === false,
     c4 ? "tb_walk_d 가 생겼다 — 조회가 적용을 일으켰다" : "tb_walk_d 없음");

  // ── ⑥ 이력에는 있는데 파일이 없는 것 ────────────────────────────
  unlinkSync(path.join(MIG, F1));
  const st2 = await migrationStatus(pool);
  // ⚠ `unknown` 전체를 보면 안 된다. 임시 cwd 에는 진짜 `db/migrations` 가 없으므로
  // 0001~0031 이 **전부** unknown 으로 잡힌다 — 그대로 `includes(F1)` 만 보면
  // 참이긴 하되 **틀린 이유로 참**이다. 9xxx 로 좁혀서 본다.
  const unk9 = st2.unknown.filter((f) => f.startsWith("9"));
  ok("⑥ 이력에만 있고 파일이 없는 것을 짚어낸다",
     unk9.length === 1 && unk9[0] === F1,
     `9xxx unknown [${unk9.join(", ")}] · (진짜 마이그레이션 ${st2.unknown.length - unk9.length}건은 임시 cwd 라서 함께 잡힌다)`);

  L("");
  L(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  // 세 줄로 자르지 않는다 — 자르면 대표할 수 없는 값이 버려진다.
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  process.chdir(REPO);
  try {
    await cleanup();
    // 치웠다고 말하기 전에 **정말 치워졌는지 센다.**
    const left = await q(
      `SELECT count(*)::int n FROM schema_migrations WHERE filename LIKE '9%_walk_%'`
    );
    const tabs = await q(
      `SELECT count(*)::int n FROM pg_tables WHERE tablename LIKE 'tb_walk_%'`
    );
    console.log(`뒷정리 확인 — 9xxx 이력 ${left[0].n} · tb_walk_* 표 ${tabs[0].n} (둘 다 0이어야 한다)`);
    if (left[0].n !== 0 || tabs[0].n !== 0) process.exitCode = 1;
    void WALK_FILES;
  } catch (e) {
    console.error("뒷정리 실패:", String(e && e.message ? e.message : e));
    process.exitCode = 1;
  }
  await pool.end().catch(() => {});
}
