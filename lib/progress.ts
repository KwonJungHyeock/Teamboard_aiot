// 진척·상태 계산기 — 단일 소스 (MD-P-2026-024 §3).
//
// 이 파일 밖에서 진척을 계산하지 않는다. 화면도, API도, SQL도.
// 이전에는 프로젝트 진척 공식만 5가지가 따로 돌아서 같은 프로젝트가 화면마다
// 다른 %를 보여줬다. 공식을 하나로 모으고, 여기서만 고친다.
//
// ── 규칙 (지시서 §3) ────────────────────────────────────────────────
//  1. 분모 제외 — resolution 이 canceled/duplicate 인 업무는 집계에서 뺀다.
//     완료로도 미완료로도 세지 않는다. deferred 는 "미완료"로 센다.
//  2. 하위 업무 우선 — 하위가 1개 이상이면 상위의 진척은 하위 완료율이다.
//     상위에 수동 진척값이 남아 있어도 무시한다.
//  3. 이중 계산 금지 — 프로젝트 진척은 최상위 업무만 대상으로 한다.
//     하위 업무는 상위를 통해 이미 반영됐다.
//  4. 목표 진척 — 연결된 프로젝트 + 목표에 직접 연결된 업무를 함께 본다.
//  5. 집계 대상 0건이면 null 이다. 0% 도 100% 도 아니다 → 화면은 "집계 없음".
//     (실제로 났던 결함이다. null 을 0 으로 접지 말 것.)

// ── 집계 대상 판정 ──────────────────────────────────────────────────

/** 집계에서 아예 빠지는 완료 사유 — 분모에도 분자에도 들어가지 않는다. */
export const EXCLUDED_RESOLUTIONS = ["canceled", "duplicate"] as const;

export const RESOLUTIONS = ["done", "canceled", "duplicate", "deferred"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  done: "완료", canceled: "취소", duplicate: "중복", deferred: "보류",
};

/** 계산에 필요한 업무의 최소 형태. 어느 화면에서 오든 이 모양이면 된다. */
export interface ProgressTask {
  status: string;
  progress: number;
  resolution?: string | null;
  /** 하위 업무 수 (0 이면 없음) */
  childCount?: number;
  /** 하위 업무 중 완료로 세어지는 수 */
  childDone?: number;
  /** 하위 업무 중 집계 대상 수 (canceled/duplicate 제외 후) */
  childCounted?: number;
}

/**
 * 이 업무를 집계에 넣는가.
 * 제외: 비활성 · proposed(승인 전) · dropped(중단) · routine(상시업무, 완료 개념 없음)
 *       · resolution 이 canceled/duplicate
 */
export function isCountable(t: { status: string; resolution?: string | null; workType?: string | null }): boolean {
  if (t.status === "proposed" || t.status === "dropped") return false;
  if (t.workType === "routine") return false;
  if (t.resolution && (EXCLUDED_RESOLUTIONS as readonly string[]).includes(t.resolution)) return false;
  return true;
}

/** 완료로 세는가. status='done' 이어도 보류(deferred)면 미완료다. */
export function isDone(t: { status: string; resolution?: string | null }): boolean {
  return t.status === "done" && t.resolution !== "deferred";
}

/**
 * 업무 1건의 진척(0~100).
 * 하위 업무가 있으면 하위 완료율이 이긴다 — 상위의 수동 진척값은 무시한다(규칙 2).
 */
export function taskProgress(t: ProgressTask): number {
  const counted = t.childCounted ?? t.childCount ?? 0;
  if (counted > 0) return Math.round((100 * (t.childDone ?? 0)) / counted);
  if (t.resolution === "deferred") return 0;   // 완료 상태여도 미완료로 센다
  if (t.status === "done") return 100;
  return Math.max(0, Math.min(100, t.progress ?? 0));
}

/** 이 업무의 진척이 하위 업무로 계산되고 있는가 — 상세 화면 안내 문구용. */
export function isRolledUpFromChildren(t: ProgressTask): boolean {
  return (t.childCounted ?? t.childCount ?? 0) > 0;
}

/**
 * 업무 묶음의 진척 — 집계 대상의 단순 평균. 대상 0건이면 null(규칙 5).
 * 프로젝트에 쓸 때는 반드시 **최상위 업무만** 넘긴다(규칙 3).
 */
export function aggregateTasks(tasks: (ProgressTask & { workType?: string | null })[]): number | null {
  const counted = tasks.filter(isCountable);
  if (counted.length === 0) return null;
  const sum = counted.reduce((a, t) => a + taskProgress(t), 0);
  return Math.round(sum / counted.length);
}

/** 집계 대상 건수 — "3/7" 같은 라벨용. 분모는 항상 aggregateTasks 와 같아야 한다. */
export function countTasks(tasks: (ProgressTask & { workType?: string | null })[]): {
  counted: number; done: number; excluded: number;
} {
  const counted = tasks.filter(isCountable);
  return {
    counted: counted.length,
    done: counted.filter(isDone).length,
    excluded: tasks.length - counted.length,
  };
}

/**
 * 목표 진척(규칙 4) — 연결 프로젝트들의 진척 + 목표에 직접 연결된 업무를 함께 본다.
 * 프로젝트 1개와 업무 1건을 같은 무게로 두지 않는다:
 * 프로젝트는 그 안의 집계 대상 업무 수만큼 무게를 갖는다.
 * 양쪽 다 비면 null(규칙 5).
 */
export function aggregateGoal(input: {
  projects: { progress: number | null; countedTasks: number }[];
  directTasks: (ProgressTask & { workType?: string | null })[];
}): number | null {
  let wsum = 0, psum = 0;
  for (const p of input.projects) {
    if (p.progress === null) continue;
    const w = Math.max(1, p.countedTasks);
    wsum += w; psum += p.progress * w;
  }
  for (const t of input.directTasks.filter(isCountable)) {
    wsum += 1; psum += taskProgress(t);
  }
  if (wsum === 0) return null;
  return Math.round(psum / wsum);
}

/** 상위 목표 = 하위 목표들의 평균. 전부 null 이면 null. */
export function rollupGoals(children: (number | null)[]): number | null {
  const vals = children.filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ── 목표 상태 판정 (MD-P-2026-024 §3 — lib/goals.ts 에서 흡수) ──────

export type GoalStatus = "ontrack" | "risk" | "wait" | "done";
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  ontrack: "온트랙", risk: "리스크", wait: "대기", done: "완료",
};

/** 기간 경과율 0~1. 종료일 포함. */
export function elapsedRatio(periodStart: string, periodEnd: string, today: string): number {
  const s = Date.parse(`${periodStart}T00:00:00Z`);
  const e = Date.parse(`${periodEnd}T00:00:00Z`) + 86400000;
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.max(0, Math.min(1, (t - s) / (e - s)));
}

/**
 * 목표 상태. progress 가 null 이면 판정하지 않는다(집계 없음) — null 을 0% 로 보지 않는다.
 */
export function judgeGoalStatus(
  progress: number | null,
  periodStart: string,
  periodEnd: string,
  today: string
): GoalStatus | null {
  if (progress !== null && progress >= 100) return "done";
  if (today < periodStart) return "wait";
  if (progress === null) return null;
  if (progress === 0) return "risk";
  const elapsed = elapsedRatio(periodStart, periodEnd, today) * 100;
  return progress - elapsed <= -15 ? "risk" : "ontrack";
}

/**
 * 수동 상태가 있으면 그것, 없으면 판정값.
 * 이 조합이 6곳에 그대로 복사돼 있었다 — 여기 하나로 모은다.
 */
export function effectiveGoalStatus(
  row: { status_manual?: string | null; period_start: string; period_end: string },
  progress: number | null,
  today: string
): GoalStatus | null {
  return (row.status_manual as GoalStatus | null) ?? judgeGoalStatus(progress, row.period_start, row.period_end, today);
}

// ── SQL 조각 — DB에서 집계할 때도 같은 정의를 쓴다 ──────────────────
// TS 쪽 isCountable / taskProgress 와 반드시 같은 뜻이어야 한다. 한쪽만 고치지 말 것.

/** 집계 대상 업무 WHERE 조건. alias 는 task 테이블의 별칭. */
export const countableSql = (t = "t") =>
  `${t}.is_active = true AND ${t}.status <> 'proposed' AND ${t}.status <> 'dropped'
   AND ${t}.work_type <> 'routine'
   AND (${t}.resolution IS NULL OR ${t}.resolution NOT IN ('canceled', 'duplicate'))`;

/** 완료로 세는 조건. */
export const doneSql = (t = "t") =>
  `${t}.status = 'done' AND (${t}.resolution IS NULL OR ${t}.resolution <> 'deferred')`;

/**
 * 업무 1건의 진척 표현식 — 하위가 있으면 하위 완료율, 없으면 자기 값.
 * 상관 서브쿼리를 쓰므로 행 수가 많은 목록에는 쓰지 말고 집계 쿼리에만 쓴다.
 */
export const taskProgressSql = (t = "t") => `
  CASE
    WHEN (SELECT count(*) FROM task c WHERE c.parent_task_id = ${t}.id AND ${countableSql("c")}) > 0
      THEN (SELECT round(100.0 * count(*) FILTER (WHERE ${doneSql("c")})
                         / count(*))
              FROM task c WHERE c.parent_task_id = ${t}.id AND ${countableSql("c")})
    WHEN ${t}.resolution = 'deferred' THEN 0
    WHEN ${t}.status = 'done' THEN 100
    ELSE ${t}.progress
  END`;

/**
 * 프로젝트 진척 표현식 — 최상위 업무만(규칙 3), 집계 대상 0건이면 NULL(규칙 5).
 * 상관 서브쿼리 하나로 끝난다: `(${projectProgressSql("p.id")})`
 */
export const projectProgressSql = (projectIdExpr: string) => `
  (SELECT round(avg(${taskProgressSql("t")}))
     FROM task t
    WHERE t.project_id = ${projectIdExpr}
      AND t.parent_task_id IS NULL
      AND ${countableSql("t")})`;

/** 프로젝트의 집계 대상 최상위 업무 수 — 목표 가중치·"n건" 라벨용. */
export const projectCountedSql = (projectIdExpr: string) => `
  (SELECT count(*) FROM task t
    WHERE t.project_id = ${projectIdExpr} AND t.parent_task_id IS NULL AND ${countableSql("t")})`;
