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
//  4. 목표 진척 (MD-P-2026-030 §A 로 갱신된 정의 — 이 문장이 정의다):
//
//       "목표 진척은 그 목표(와 하위 목표)에 **직접 연결된** 업무 전체의 평균이다.
//        업무만 목표에 붙는다. 프로젝트도 하위 목표도 그룹핑 단위이며 계산 단위가 아니다."
//
//     예전 정의에는 "프로젝트를 통해 세어진 업무"라는 두 번째 경로가 있었다.
//     경로가 둘이면 같은 질문에 두 답이 나온다 — 배너는 "미연결"이라 하고
//     진척은 "집계됨"이라 하는 상태가 실제로 있었고, 프로젝트가 8월 목표를 가리키면
//     그 프로젝트의 7월 업무까지 8월 분모에 섞였다. 경로를 하나로 줄여 없앤다.
//
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

// aggregateGoal(프로젝트 가중 평균)은 MD-P-2026-030 §A3 에서 없앴다.
// 프로젝트가 계산 단위였을 때만 필요한 함수였고, 남겨 두면 "계산기는 하나"가 다시 깨진다.
// 목표 집계는 goalSubtreeTaskInput() → aggregateTasks() 한 경로뿐이다.

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
  today: string,
  /** 집계 대상 업무 수. 넘기면 표본 부족일 때 판정하지 않는다 (지시 16) */
  counted?: number
): GoalStatus | null {
  // 표본이 1~2건이면 "온트랙"도 "리스크"도 말할 수 없다. 판정 불가로 둔다.
  if (counted !== undefined && isUnderSampled(counted)) return null;
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

// ── 목표 연결 판정 — 경로는 하나뿐이다 (MD-P-2026-030 §A·§B) ─────────
//
// **목표에 붙는 것은 업무뿐이고, 붙는 방법은 goal_task 하나뿐이다.**
// 이 두 조각(연결됨 / 미연결)이 진척 계산기·분모·배너가 함께 읽는 유일한 정의다.
// 한쪽만 고치면 배너와 진척이 다시 다른 말을 한다 — 그것이 030 이 고친 결함이다.

/** 이 업무가 **어떤** 목표에든 직접 연결돼 있는가. */
export const goalLinkedSql = (t = "t") =>
  `EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = ${t}.id)`;

/** 이 업무가 주어진 목표 집합(보통 서브트리) 중 하나에 직접 연결돼 있는가. */
export const goalLinkedInSql = (t: string, goalIdsSelect: string) =>
  `EXISTS (SELECT 1 FROM goal_task gt
            WHERE gt.task_id = ${t}.id AND gt.goal_id IN (${goalIdsSelect}))`;

/** 목표 서브트리 CTE — 이 목표와 살아 있는 모든 자손. 이름은 항상 `sub`. */
export const goalSubtreeCte = (goalIdExpr: string) => `
  WITH RECURSIVE sub AS (
    SELECT id FROM goal WHERE id = ${goalIdExpr} AND is_active = true
    UNION ALL
    SELECT g.id FROM goal g JOIN sub ON g.parent_id = sub.id WHERE g.is_active = true
  )`;

/**
 * 미연결 업무 (§B1·§B2) — 목표 화면 배너와 일괄 연결 화면이 **같은 이 조건**을 쓴다.
 *
 *   미연결 = 집계 대상 · 최상위 업무 · 직접 연결 없음 · goal_source <> 'none'
 *
 * "목표 없음"(none)은 사람이 정한 상태지 미연결이 아니다 (지시 23-2).
 * 집계 대상 조건이 진척 계산기와 같아야 "미연결인데 진척엔 잡힌다"가 생기지 않는다.
 */
export const unlinkedTaskSql = (t = "t") =>
  `${t}.parent_task_id IS NULL AND ${countableSql(t)}
   AND NOT ${goalLinkedSql(t)}
   AND ${t}.goal_source <> 'none'`;

/**
 * 목표에 **속한 업무 수** — 화면의 "업무 N건 기준" 보조 텍스트가 쓰는 분모.
 *
 * 정의 그대로다: 목표에 속한 업무 = 그 목표(또는 하위 목표)에 직접 연결된 업무.
 * 하위 목표가 있는 상위 목표(분기·연간)는 서브트리 전체를 훑는다.
 * 이 수는 `goalSubtreeTaskInput()` 이 돌려주는 행 수와 **반드시** 같아야 한다.
 */
export const goalCountedSql = (goalIdExpr: string) => `
  (${goalSubtreeCte(goalIdExpr)}
   SELECT count(*) FROM task t
    WHERE t.parent_task_id IS NULL AND ${countableSql("t")}
      AND ${goalLinkedInSql("t", "SELECT id FROM sub")})`;

// ── 표본 가드 (MD-P-2026-024 회신 6 지시 16) ──────────────────
//
// 업무 1건으로 연간 목표가 100% 초록 막대가 되는 일이 실제로 있었다.
// 숫자가 틀린 게 아니라 **표본이 없는 값을 단정해서 보여준 것**이 문제다.
// 집계 대상이 너무 적으면 %를 말하지 않는다 — 몇 건인지만 말한다.

/** 이 수 미만이면 진척을 단정하지 않는다. */
export const MIN_SAMPLE = 3;

/** 표본이 부족한가 — 0건(집계 없음)은 별개다. 1~2건일 때가 표본 부족이다. */
export function isUnderSampled(counted: number): boolean {
  return counted > 0 && counted < MIN_SAMPLE;
}

/**
 * 진척 막대를 그려도 되는가.
 * 0건 → 그리지 않는다("집계 없음"). 1~2건 → 그리지 않는다(표본 부족).
 */
export function canShowBar(counted: number): boolean {
  return counted >= MIN_SAMPLE;
}

/**
 * "업무 14건 기준" / 1~2건이면 "업무 2건 — 표본 부족" / 0건이면 "집계 없음".
 * 문구를 여기 하나로 둔다.
 */
export function countedLabel(counted: number): string {
  if (counted === 0) return "집계 없음";
  if (isUnderSampled(counted)) return `업무 ${counted}건 — 표본 부족`;
  return `업무 ${counted}건 기준`;
}

/**
 * **값이 이미 화면에 떠 있을 때** 그 옆에 붙는 근거 문구.
 *
 * countedLabel() 과 나눠 둔 이유 — 0건일 때 뜻이 다르다.
 *   countedLabel(0) = "집계 없음"  … 값 자체가 없다
 *   basisLabel(0)  = "집계 대상 업무 0건" … 값은 있는데(수동값 등) 셀 업무가 없다
 * 둘을 같은 문구로 두면 화면에 **"50% · 집계 없음"** 이 나란히 뜬다.
 * 실제로 그렇게 떠 있었고, 캡처를 열어 보고서야 발견했다 (MD-P-2026-030 §A3 검증).
 */
export function basisLabel(counted: number): string {
  if (counted === 0) return "집계 대상 업무 0건";
  return countedLabel(counted);
}

/**
 * 진척을 **어떻게 보여줄지** 한 곳에서 정한다 (MD-P-2026-030 지시 30-5).
 *
 * 이 함수가 없어서 갈라졌던 일. 연간 카드가 막대를 직접 그리느라 canShowBar() 를 안 불렀고,
 * 집계 대상 1건짜리 연간 목표가 **100% 초록 막대**로 떴다. 지시 16 이 막으려던 장면이다.
 * 판정만 공유해도 라벨 조립이 또 갈라지므로, **표시 결정 전체**를 여기서 낸다.
 *
 * 표본 부족의 뜻 (지시 30 [확정]):
 *   "값이 없다"가 아니라 **"값의 신뢰도가 낮다"** 는 뜻이다.
 *   값은 보이고 막대는 그리지 않는다 — 과잉 확신을 만드는 것은 숫자가 아니라 막대다.
 *   숫자는 읽어야 보이지만 막대는 훑어도 보인다.
 */
export interface ProgressDisplay {
  /** 채운 막대를 그리는가. 표본 부족이면 빈 트랙만 남는다 (30-3). */
  drawBar: boolean;
  /** 보여줄 값이 있는가. 없으면 "집계 없음". */
  hasValue: boolean;
  /** 값 옆에 붙는 근거. "업무 14건 기준" / "업무 1건 — 표본 부족" */
  basis: string | null;
  /** 표본 부족 — 숫자를 흐리게 낮춘다 (30-2). */
  lowConfidence: boolean;
}

export function progressDisplay(progress: number | null, counted?: number): ProgressDisplay {
  const low = counted !== undefined && isUnderSampled(counted);
  if (progress === null) {
    return { drawBar: false, hasValue: false, basis: null, lowConfidence: false };
  }
  return {
    drawBar: counted === undefined || canShowBar(counted),
    hasValue: true,
    basis: counted === undefined ? null : basisLabel(counted),
    lowConfidence: low,
  };
}

/** "미집계 하위 3개" — 집계 대상이 0건인 하위 목표 수를 알린다(지시 16). */
export function uncountedChildrenLabel(n: number): string | null {
  return n > 0 ? `미집계 하위 ${n}개` : null;
}

// ── 기간이 끝난 목표의 마감값 (MD-P-2026-024 회신 3 지시 7) ────────────
//
// 기간이 지난 목표는 "지금 집계"가 아니라 **끝난 시점의 기록**을 보여준다.
// 7월 목표에 8월 업무가 붙거나 프로젝트가 떠나가면 지금 집계는 7월 실적과 무관해진다.
//
// 없는 마감값은 **만들지 않는다.** 스냅샷이 없으면 없다고 말한다 —
// 수동값을 넣어 메우지 않는다(그건 기록이 아니라 창작이다).

/** 기간이 끝난 목표의 마감 기록. 스냅샷이 없으면 progress·date 가 null. */
export interface GoalClosing {
  /** 기간 종료일이 지났는가 */
  ended: boolean;
  /** 마감 시점 진척. 스냅샷이 없으면 null */
  progress: number | null;
  /** 그 값을 찍은 스냅샷 날짜 (YYYY-MM-DD) */
  date: string | null;
}

/** "57% · 7/31 마감 기준" / 기록이 없으면 "기간 종료 · 마감 기록 없음". */
export function closingLabel(c: GoalClosing): string {
  if (c.progress === null || c.date === null) return "기간 종료 · 마감 기록 없음";
  const [, m, d] = c.date.split("-");
  return `${c.progress}% · ${Number(m)}/${Number(d)} 마감 기준`;
}

/**
 * 기간 종료일 시점의 스냅샷 — 종료일 당일, 없으면 **그 이전 가장 가까운 날**.
 * 종료일 이후 스냅샷은 보지 않는다(그건 마감값이 아니다).
 */
export const goalClosingSql = (goalIdExpr: string, periodEndExpr: string) => `
  (SELECT jsonb_build_object('progress', s.progress, 'date', s.snapshot_date::text)
     FROM goal_snapshot s
    WHERE s.goal_id = ${goalIdExpr} AND s.snapshot_date <= ${periodEndExpr}
    ORDER BY s.snapshot_date DESC
    LIMIT 1)`;
