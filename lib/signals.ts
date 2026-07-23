// 시그널 공통 로직 (Phase 6) — 가시성 규칙과 config 임계값의 단일 소스.
// 라우트마다 SQL을 복제하지 않도록 여기서만 정의한다.
import { queryOne } from "./db";

/** 정체 임계값 (config.signal_thresholds). 행 부재 시 SPEC 기본값 폴백 */
export async function getSignalThresholds(): Promise<Record<string, number | null>> {
  return ((await queryOne<{ value: any }>(
    `SELECT value FROM config WHERE key = 'signal_thresholds'`
  ))?.value ?? { decision: 14, review: 7, memo: null, risk: 0 }) as Record<string, number | null>;
}

/** 미실행 결정(decided) 정체 임계 일수 (config.signal_decided_stale_days). 기본 7 */
export async function getDecidedStaleDays(): Promise<number> {
  const row = await queryOne<{ value: any }>(
    `SELECT value FROM config WHERE key = 'signal_decided_stale_days'`
  );
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/**
 * 시그널 가시성 WHERE 절 — 뷰어 id 플레이스홀더를 받아 조건 문자열을 만든다.
 *   private : 작성자 본인만
 *   review  : 작성자 + 대상(target_actor) + lead
 *   그 외   : 팀 전체
 * lead는 review까지 볼 수 있어야 하므로 뷰어 role을 서브쿼리로 확인한다.
 */
export function signalVisibilityClause(viewerParam: string): string {
  return `(
    (s.scope <> 'private' AND s.type <> 'review')
    OR (s.scope = 'private' AND s.author_id = ${viewerParam})
    OR (s.type = 'review' AND (
          s.author_id = ${viewerParam}
          OR s.target_actor_id = ${viewerParam}
          OR EXISTS (SELECT 1 FROM account acc WHERE acc.actor_id = ${viewerParam} AND acc.role = 'lead')
       ))
  )`;
}
