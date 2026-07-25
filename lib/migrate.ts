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

export interface MigrateResult {
  applied: string[];
  alreadyDone: number;
}

export async function runMigrations(pool: Pool): Promise<MigrateResult> {
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 0001_, 0002_ … 파일명 오름차순 = 적용 순서

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
    const doneRows = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations"
    );
    const done = new Set(doneRows.rows.map((r) => r.filename));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
        console.info(`[migrate] 적용 완료: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[migrate] 실패: ${file} — ${msg}`);
        throw new Error(`마이그레이션 실패 (${file}): ${msg}`);
      }
    }
    return { applied, alreadyDone: done.size };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
