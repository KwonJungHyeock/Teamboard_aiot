// 자동 마이그레이션 러너 (파트 X) — 배포 후 최초 DB 접근 시 미적용 마이그레이션만 순서대로 실행.
// db/migrations/NNNN_*.sql 를 파일명 오름차순으로 적용하고 schema_migrations 에 이력을 남긴다.
// 콘솔·임시 라우트 없이 "배포만으로" 스키마가 반영된다.
//
// 안전 규칙:
//  - 각 파일은 자체 트랜잭션. 실패 시 롤백하고 전체 중단(이후 파일 미적용).
//  - pg advisory lock 으로 동시 인스턴스(서버리스 콜드스타트 병렬)의 중복 적용 방지.
//  - 데이터 삭제 금지 — 마이그레이션 파일은 ADD COLUMN/CREATE TABLE 등 비파괴만 권장.
//    파괴적 변경(DROP·타입변경)은 별도 파일 + 주석 경고로 분리한다(파일 내 규약).
import { readdir, readFile } from "fs/promises";
import path from "path";
import type { Pool } from "pg";

// 고정 advisory lock 키 (임의값) — 동일 DB에 대해 한 번에 하나의 러너만.
const LOCK_KEY = 918273465;

// 마이그레이션 파일이 있는 곳. **한 곳에서만 계산한다** — 목록을 세는 쪽과 파일을
// 읽는 쪽이 서로 다른 경로를 보면 「목록에는 있는데 못 읽는」 상태가 생긴다.
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/**
 * **어느 배포가 이 마이그레이션을 적용했는가.**
 *
 * 0029·0030 은 47ms 간격으로 적용되고 0031 에서 멈췄다. 그때 우리가 답할 수 없었던
 * 질문이 **「그 47ms 는 어느 배포에서 흘렀는가」**다. 미리보기 배포인지 프로덕션
 * 배포인지 알면 원인이 크게 좁혀지는데, **DB 에는 그 정보가 없었고 Vercel 로그는
 * 우리가 못 본다.** 그래서 시각 하나로 추측할 수밖에 없었다.
 *
 * 이제 이력 행에 함께 적는다. 다음에 같은 일이 생기면
 * `SELECT filename, applied_at, applied_by FROM schema_migrations` 한 줄로 끝난다.
 *
 * 값이 없으면 `local` — 개발 기계에서 돈 것이다.
 */
function deploymentTag(): string {
  const env = process.env.VERCEL_ENV; // production | preview | development
  if (!env) return "local";
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? "?";
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "?";
  return `${env}:${ref}@${sha}`;
}

export interface MigrateResult {
  applied: string[];
  alreadyDone: number;
  /** 파일은 있는데 `schema_migrations` 에 없는 것. **정상이면 빈 배열이다.** */
  missing: string[];
}

/**
 * 지금 **어디까지 적용됐는가** — 읽기 전용.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 *
 * 0029·0030 이 적용되고 **0031 이 조용히 빠졌다.** 사이트는 정상으로 떴고 오류도
 * 안 났다. PM 이 `schema_migrations` 를 직접 조회하지 않았으면 영영 몰랐을 것이다.
 *
 * 러너는 실패하면 던지고 멈춘다(아래). 그러니 **던지지도 않고 빠졌다**는 것은
 * 실패가 아니라 **아예 안 돌았다**는 뜻이다 — 마이그레이션은 사용자 요청 안에서
 * 돌기 때문에, 그 요청이 끝나거나 프로세스가 내려가면 남은 파일은 그냥 안 돈다.
 * 다음 요청이 다시 시도하지만, **그 사이에 아무도 모른다는 것**이 문제다.
 *
 * > **어디까지 적용됐는지를 앱이 알 수 있어야 한다.**
 *
 * 그래서 파일 목록과 이력을 대조하는 함수를 따로 둔다. 러너 안에만 있으면
 * 러너를 돌려야만 알 수 있고, 러너를 돌리는 것은 곧 적용하는 것이다.
 */
export interface AppliedRow {
  filename: string;
  applied_at: string;
  /** 어느 배포가 적용했는가. 이 컬럼이 생기기 전 행은 `null` 이다. */
  applied_by: string | null;
}

export async function migrationStatus(pool: Pool): Promise<{
  files: string[];
  applied: AppliedRow[];
  /** 파일은 있는데 이력에 없는 것. **하나라도 있으면 스키마가 코드보다 뒤처져 있다.** */
  missing: string[];
  /** 이력에는 있는데 파일이 없는 것. 파일을 지웠거나 롤백 뒤 이력을 안 지운 것. */
  unknown: string[];
  ok: boolean;
}> {
  const files = await listMigrationFiles();
  // `applied_by` 는 러너가 부트스트랩에서 만든다. 러너가 아직 한 번도 안 돈 DB 를
  // 대비해 컬럼 없이도 답이 나오게 한다 — 조회가 조회 때문에 실패하면 안 된다.
  const { rows } = await pool.query<AppliedRow>(
    `SELECT filename, applied_at,
            (to_jsonb(m) ->> 'applied_by') AS applied_by
       FROM schema_migrations m ORDER BY filename`
  );
  const done = new Set(rows.map((r) => r.filename));
  const haveFile = new Set(files);
  const missing = files.filter((f) => !done.has(f));
  const unknown = rows.map((r) => r.filename).filter((f) => !haveFile.has(f));
  return { files, applied: rows, missing, unknown, ok: missing.length === 0 };
}

async function listMigrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 0001_, 0002_ … 파일명 오름차순 = 적용 순서
}

export async function runMigrations(pool: Pool): Promise<MigrateResult> {
  const files = await listMigrationFiles();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // 크로스 인스턴스 직렬화 — 락을 못 잡으면 대기(동시 배포 시 한쪽만 적용).
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);

    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    // 러너 **자신의** 표라서 마이그레이션 번호를 쓰지 않는다. 여기서 부트스트랩한다 —
    // 새 DB 든 이미 돌던 DB 든 같은 한 줄로 맞는다.
    await client.query(
      "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_by TEXT"
    );
    const doneRows = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations"
    );
    const done = new Set(doneRows.rows.map((r) => r.filename));

    const pending = files.filter((f) => !done.has(f));
    const where = deploymentTag();
    if (pending.length) {
      // **적용을 시작하기 전에** 무엇을 몇 개 적용할 작정인지 먼저 적는다.
      // 중간에 프로세스가 내려가도 이 줄은 남아, 「어디까지 하려 했는지」가 보인다.
      console.info(
        `[migrate] ${where} · 파일 ${files.length} · 이력 ${done.size} · ` +
        `적용 예정 ${pending.length}건: ${pending.join(", ")}`
      );
    }

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, applied_by) VALUES ($1, $2)",
          [file, where]
        );
        await client.query("COMMIT");
        applied.push(file);
        console.info(`[migrate] 적용 완료: ${file} (${where})`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        // **여기서 멈춘다.** 뒤 파일로 넘어가지 않는다 — 반쯤 적용된 스키마 위에
        // 다음 파일을 얹으면 무엇이 참인지 아무도 모르게 된다.
        // 남은 것이 몇 건인지 함께 적는다. 「하나 실패」와 「하나 실패 + 다섯 대기」는
        // 급한 정도가 다르다.
        const rest = pending.slice(pending.indexOf(file) + 1);
        console.error(
          `[migrate] 실패: ${file} — ${msg}\n` +
          `[migrate]   ${where} · 여기서 중단한다. 뒤따르던 ${rest.length}건은 적용하지 않는다` +
          (rest.length ? `: ${rest.join(", ")}` : "")
        );
        throw new Error(`마이그레이션 실패 (${file}): ${msg}`);
      }
    }
    /*
     * ── 끝났다고 말하기 전에 **정말 다 됐는지 다시 센다** ──────────
     *
     * 이 단언은 **거의 안 걸릴 것이다.** 루프는 실패하면 던지고 멈추므로 여기까지
     * 왔다면 이미 참이어야 한다. 그래도 세는 이유는, 0031 을 놓친 뒤로
     * 「참이어야 한다」를 근거로 삼지 않기로 했기 때문이다.
     *
     * ⚠ **이것으로 0031 같은 일을 잡을 수는 없다.** 그때 빠진 이유는 루프가 실패한
     * 것이 아니라 **루프가 그 파일에 도달하지 못한 것**이고, 도달하지 못했으면
     * 여기에도 도달하지 못한다. 예외도 로그도 아무 데도 안 남는다(받을 사람이
     * 이미 없다). 그 경우를 드러내는 것은 이 블록이 아니라 위의 「적용 예정」 줄과
     * `migrationStatus()`(러너를 돌리지 않고 밖에서 묻는 길)다.
     */
    const doneAfter = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations"
    );
    const have = new Set(doneAfter.rows.map((r) => r.filename));
    const missing = files.filter((f) => !have.has(f));
    if (missing.length) {
      console.error(
        `[migrate] ⚠ 적용되지 않은 마이그레이션 ${missing.length}건: ${missing.join(", ")}\n` +
        `[migrate]   파일은 있는데 schema_migrations 에 없다. 다음 요청에서 다시 시도한다.`
      );
    }
    return { applied, alreadyDone: done.size, missing };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
