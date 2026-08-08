// 성과 스냅샷 적립 (MD-P-2026-011) — 목표 진척의 시점 기록.
//
// 왜 필요한가: goal.progress는 "지금" 값만 들고 있어서 지난 달 리포트를 만들 수 없었다.
// 소급 추정은 금지(MD-P-2026-010 §E)이므로 지금부터 매일 적립한다. 미루면 빈 구간만 늘어난다.
//
// 저장값은 lib/goals.ts의 집계 결과를 그대로 옮긴다 — 여기서 다시 계산하지 않는다(§제약).
import { query, queryOne } from "./db";
import { judgeGoalStatus, kstTodayForGoals, type GoalStatus } from "./goals";

export type SnapshotSource = "auto" | "manual";

export interface SnapshotResult {
  date: string;
  goalCount: number;
  durationMs: number;
  source: SnapshotSource;
}

/**
 * 오늘(KST) 자 스냅샷 1회 적립. 같은 날 다시 실행하면 덮어쓴다(upsert).
 * 진척이 null인 목표도 null 그대로 남긴다 — 없는 데이터를 0으로 채우지 않는다(§제약).
 */
export async function captureGoalSnapshots(
  source: SnapshotSource = "auto",
  forDate?: string
): Promise<SnapshotResult> {
  const started = Date.now();
  const date = forDate ?? kstTodayForGoals();

  const goals = await query<{
    id: number; progress: string | null; status_manual: GoalStatus | null;
    period_start: string; period_end: string; project_count: number;
  }>(
    // linked_project_count 는 goal_snapshot 의 **역사 컬럼**이다.
    // 프로젝트→목표 연결은 MD-P-2026-030 §A 에서 진척 계산에서 빠졌지만,
    // project.goal_id 데이터 자체는 보존한다(§A5). 그래서 여기서도 있는 그대로 계속 찍는다 —
    // 0 으로 덮으면 지나간 달의 기록까지 거짓이 된다. 다만 이 값은 이제 진척과 무관하다.
    `SELECT g.id, g.progress::text, g.status_manual,
            g.period_start::text, g.period_end::text,
            (SELECT count(*)::int FROM project pj
              WHERE pj.goal_id = g.id AND pj.is_active = true AND pj.status <> 'archived') AS project_count
       FROM goal g WHERE g.is_active = true`
  );

  for (const g of goals) {
    const progress = g.progress === null ? null : Math.round(Number(g.progress));
    // 상태도 같이 굳힌다 — 나중에 "그때 리스크였나"를 되짚을 수 있게.
    const status = g.status_manual ?? judgeGoalStatus(progress, g.period_start, g.period_end, date);
    await query(
      `INSERT INTO goal_snapshot (goal_id, snapshot_date, period_ym, progress, status, linked_project_count, source, captured_at)
       VALUES ($1, $2::date, to_char($2::date, 'YYYY-MM'), $3, $4, $5, $6, now())
       ON CONFLICT (goal_id, snapshot_date)
       DO UPDATE SET progress = EXCLUDED.progress,
                     status = EXCLUDED.status,
                     linked_project_count = EXCLUDED.linked_project_count,
                     source = EXCLUDED.source,
                     period_ym = EXCLUDED.period_ym,
                     captured_at = now()`,
      [g.id, date, progress, status, g.project_count, source]
    );
  }

  return { date, goalCount: goals.length, durationMs: Date.now() - started, source };
}

/** 실행 이력 기록 (§F) — 성공·실패 모두 남긴다. */
export async function logSnapshotRun(r: {
  date: string; source: SnapshotSource; ok: boolean;
  goalCount: number; durationMs: number; error?: string;
}): Promise<void> {
  await query(
    `INSERT INTO snapshot_run (run_date, source, ok, goal_count, duration_ms, error)
     VALUES ($1::date, $2, $3, $4, $5, $6)`,
    [r.date, r.source, r.ok, r.goalCount, r.durationMs, r.error ?? null]
  );
}

/** 최근 실행 이력 — 조회용. */
export async function recentSnapshotRuns(limit = 20) {
  return query<{
    id: number; run_date: string; source: string; ok: boolean;
    goal_count: number; duration_ms: number; error: string | null; created_at: string;
  }>(
    `SELECT id, run_date::text, source, ok, goal_count, duration_ms, error, created_at::text
       FROM snapshot_run ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
}

/** 직전 두 번의 자동 실행이 모두 실패했는가 — 1회 실패는 재시도로 보고 알리지 않는다(§F). */
export async function failedTwiceInARow(): Promise<boolean> {
  const rows = await query<{ ok: boolean }>(
    `SELECT ok FROM snapshot_run WHERE source = 'auto' ORDER BY created_at DESC LIMIT 2`
  );
  return rows.length === 2 && rows.every((r) => !r.ok);
}

/** 적립 실패를 활동 인박스 "시스템" 탭에 알린다 (§F). 팀장 전원에게 1건씩. */
export async function notifySnapshotFailure(message: string): Promise<void> {
  const leads = await query<{ actor_id: number }>(
    `SELECT ac.actor_id FROM account ac JOIN actor a ON a.id = ac.actor_id
      WHERE ac.role = 'lead' AND a.is_active = true`
  );
  const day = kstTodayForGoals();
  for (const l of leads) {
    await query(
      `INSERT INTO notification (user_id, type, ref_type, ref_id, snippet, actor_id, dedupe_key)
       VALUES ($1, 'system', 'system', NULL, $2, NULL, $3)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [l.actor_id, `성과 스냅샷 적립 실패 · ${message}`.slice(0, 200), `snapshot-fail:${day}`]
    );
  }
}

/**
 * 오늘자 스냅샷이 있는지 보장한다 (§C).
 * Vercel에는 "배포 직후 1회" 훅이 없어서, 배포 후 첫 목표·리포트 접근 때 한 번 채운다.
 * upsert라 여러 인스턴스가 동시에 들어와도 안전하고, 프로세스당 1회만 확인한다.
 */
let ensuredFor: string | null = null;
export async function ensureTodaySnapshot(): Promise<void> {
  const today = kstTodayForGoals();
  if (ensuredFor === today) return;
  ensuredFor = today;
  const existing = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM goal_snapshot WHERE snapshot_date = $1::date`, [today]
  );
  if (Number(existing?.n ?? 0) > 0) return;
  try {
    const r = await captureGoalSnapshots("auto", today);
    await logSnapshotRun({ date: r.date, source: "auto", ok: true, goalCount: r.goalCount, durationMs: r.durationMs });
  } catch (e) {
    ensuredFor = null; // 실패하면 다음 요청에서 다시 시도한다
    await logSnapshotRun({
      date: today, source: "auto", ok: false, goalCount: 0, durationMs: 0,
      error: e instanceof Error ? e.message : "알 수 없는 오류",
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 조회 — 리포트·차트가 쓰는 읽기 경로 (§E)
// ─────────────────────────────────────────────────────────────

/** 그 달의 "마지막" 스냅샷. 없으면 null → 화면은 "기록 없음". */
export async function monthEndSnapshot(goalId: number, ym: string): Promise<{
  date: string; progress: number | null; status: GoalStatus | null;
} | null> {
  const r = await queryOne<{ snapshot_date: string; progress: string | null; status: GoalStatus | null }>(
    `SELECT snapshot_date::text, progress::text, status FROM goal_snapshot
      WHERE goal_id = $1 AND to_char(snapshot_date, 'YYYY-MM') = $2
      ORDER BY snapshot_date DESC LIMIT 1`,
    [goalId, ym]
  );
  if (!r) return null;
  return {
    date: r.snapshot_date,
    progress: r.progress === null ? null : Math.round(Number(r.progress)),
    status: r.status,
  };
}

export interface TrendPoint { ym: string; date: string; progress: number | null }

/**
 * 최근 N개월 추이 (§E) — 스냅샷이 있는 달만 점으로 돌려준다.
 * 없는 달은 아예 배열에 넣지 않는다. 선을 이어 없는 구간을 메우면 그게 추정이다.
 */
export async function goalTrend(goalId: number, months = 6): Promise<TrendPoint[]> {
  const rows = await query<{ ym: string; snapshot_date: string; progress: string | null }>(
    `SELECT DISTINCT ON (to_char(snapshot_date, 'YYYY-MM'))
            to_char(snapshot_date, 'YYYY-MM') AS ym, snapshot_date::text, progress::text
       FROM goal_snapshot
      WHERE goal_id = $1
        AND snapshot_date >= (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - make_interval(months => $2 - 1))::date
      ORDER BY to_char(snapshot_date, 'YYYY-MM'), snapshot_date DESC`,
    [goalId, months]
  );
  return rows
    .map((r) => ({
      ym: r.ym,
      date: r.snapshot_date,
      progress: r.progress === null ? null : Math.round(Number(r.progress)),
    }))
    .sort((a, b) => (a.ym < b.ym ? -1 : 1));
}
