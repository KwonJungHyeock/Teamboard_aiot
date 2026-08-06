// 월별 성과 리포트 (MD-P-2026-010) — 서버 집계. 클라이언트는 이 값을 그리기만 한다.
// 진척 계산은 새로 만들지 않고 lib/goals.ts의 저장값(집계 결과)을 그대로 읽는다.
//
// 정직성 원칙(§E, MD-P-2026-009 계승):
//   · 데이터 없음(null)과 0%는 절대 같게 만들지 않는다.
//   · 전월 대비 증감은 전월 스냅샷이 실제로 있을 때만 낸다. 추정하지 않는다.
//   · 항목이 없으면 빈 배열로 두고, 화면이 "이번 달 해당 항목이 없습니다"를 쓴다.
import { query, queryOne } from "./db";
import { visibleTaskSql } from "./visibility";
import { judgeGoalStatus, kstTodayForGoals, type GoalStatus } from "./goals";
import { ensureTodaySnapshot } from "./goal-snapshot";

export type ReportScope = "team" | "personal";

export interface PerfGoalRow {
  id: number;
  level: "annual" | "quarter" | "month";
  levelLabel: string;
  title: string;
  period: string;
  progress: number | null;
  /** 전월 스냅샷. 없으면 null → 증감 미표시 */
  prevProgress: number | null;
  /** progress - prevProgress. 둘 중 하나라도 null이면 null */
  delta: number | null;
  status: GoalStatus | null;
  manual: boolean;
  projectCount: number;
}

export interface PerfTaskRow {
  id: number;
  title: string;
  areaName: string | null;
  projectName: string | null;
  assigneeName: string | null;
  status: string;
  progress: number;
  dueDate: string | null;
  completedAt: string | null;
  /** 이 달을 넘겨 다음 달로 이월되는 업무 */
  carryOver: boolean;
}

export interface PerfDecisionRow {
  id: number;
  title: string;
  rationale: string;
  decidedByName: string;
  decidedAt: string;
  projectName: string | null;
}

export interface PerfReport {
  year: number;
  month: number;
  ym: string;                 // 2026-08
  periodLabel: string;        // 2026년 8월
  docNo: string;              // MD-M-2026-08
  scope: ReportScope;
  targetLabel: string;        // "플랫폼팀" | "권정혁"
  generatedAt: string;        // YYYY-MM-DD
  isCurrentMonth: boolean;
  /** 과거 월인데 그 달 진척 스냅샷이 없어 진척을 표시할 수 없는 경우 */
  missingSnapshot: boolean;

  summary: {
    completed: number;
    inProgress: number;
    /** 목표 평균 진척 — 집계 가능한 목표가 없으면 null */
    goalAvg: number | null;
    goalAvgPrev: number | null;
    goalAvgDelta: number | null;
    decisions: number;
  };
  goals: PerfGoalRow[];
  completedTasks: PerfTaskRow[];
  ongoingTasks: PerfTaskRow[];
  decisions: PerfDecisionRow[];
  nextTasks: PerfTaskRow[];
}

const KST = "+09:00";
const pad = (n: number) => String(n).padStart(2, "0");

function bounds(year: number, month: number) {
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    ym: `${year}-${pad(month)}`,
    prevYm: month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`,
    nextYm: `${ny}-${pad(nm)}`,
    startTs: `${year}-${pad(month)}-01T00:00:00${KST}`,
    nextTs: `${ny}-${pad(nm)}-01T00:00:00${KST}`,
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`,
    nextStartDate: `${ny}-${pad(nm)}-01`,
    nextEndDate: `${ny}-${pad(nm)}-${new Date(Date.UTC(ny, nm, 0)).getUTCDate()}`,
  };
}

const LEVEL_LABEL: Record<string, string> = { annual: "연간", quarter: "분기", month: "월간" };

export async function buildPerfReport(opts: {
  year: number;
  month: number;
  scope: ReportScope;
  actorId: number | null;      // personal일 때 대상자
  viewerId: number;            // 보는 사람 — 개인 업무 노출 판단에 쓴다 (MD-P-2026-025 §A3 ⑥)
  teamLabel?: string;
}): Promise<PerfReport> {
  const { year, month, scope } = opts;
  const b = bounds(year, month);
  const today = kstTodayForGoals();
  const isCurrentMonth = today.slice(0, 7) === b.ym;

  // 오늘자 적립을 보장한다 (§C) — cron이 아직 돌지 않았어도 오늘 기록은 남는다.
  await ensureTodaySnapshot();

  const targetName = opts.actorId
    ? (await queryOne<{ display_name: string }>(`SELECT display_name FROM actor WHERE id = $1`, [opts.actorId]))?.display_name ?? "구성원"
    : null;

  // ── 목표 ──
  // 팀: 해당 월을 포함하는 팀 목표 전부(연간·분기·월)
  // 개인: 대상자의 개인 목표만 — 팀 목표를 개인 성과로 환산하지 않는다(§E 추정 금지)
  const goalRows = await query<{
    id: number; level: string | null; period_type: string; title: string; period: string | null;
    period_start: string; period_end: string; progress: string | null; progress_manual: string | null;
    status_manual: GoalStatus | null; project_count: number;
    prev: string | null; snap: string | null; has_snap: boolean; snap_status: GoalStatus | null;
  }>(
    `SELECT g.id, g.level, g.period_type, g.title, g.period,
            g.period_start::text, g.period_end::text, g.progress::text, g.progress_manual::text,
            g.status_manual,
            (SELECT count(*)::int FROM project pj
              WHERE pj.goal_id = g.id AND pj.is_active = true AND pj.status <> 'archived') AS project_count,
            (SELECT s.progress::text FROM goal_snapshot s
              WHERE s.goal_id = g.id AND to_char(s.snapshot_date, 'YYYY-MM') = $3
              ORDER BY s.snapshot_date DESC LIMIT 1) AS prev,
            (SELECT s.progress::text FROM goal_snapshot s
              WHERE s.goal_id = g.id AND to_char(s.snapshot_date, 'YYYY-MM') = $4
              ORDER BY s.snapshot_date DESC LIMIT 1) AS snap,
            EXISTS (SELECT 1 FROM goal_snapshot s
                     WHERE s.goal_id = g.id AND to_char(s.snapshot_date, 'YYYY-MM') = $4) AS has_snap,
            (SELECT s.status FROM goal_snapshot s
              WHERE s.goal_id = g.id AND to_char(s.snapshot_date, 'YYYY-MM') = $4
              ORDER BY s.snapshot_date DESC LIMIT 1) AS snap_status
       FROM goal g
      WHERE g.is_active = true
        AND g.period_start <= $2::date AND g.period_end >= $1::date
        AND ${scope === "team" ? `g.scope = 'team'` : `(g.scope = 'personal' AND g.owner_actor_id = $5)`}
      ORDER BY CASE COALESCE(g.level, g.period_type)
                 WHEN 'annual' THEN 1 WHEN 'year' THEN 1
                 WHEN 'quarter' THEN 2 ELSE 3 END,
               g.period_start, g.id`,
    scope === "team"
      ? [b.startDate, b.endDate, b.prevYm, b.ym]
      : [b.startDate, b.endDate, b.prevYm, b.ym, opts.actorId]
  );

  // 지난 달 리포트에 오늘 값을 적으면 그건 그 달의 성과가 아니다.
  // 과거 월은 그 달 스냅샷만 쓰고, 스냅샷이 없으면 "-"로 남긴다 (§E 추정 금지).
  let missingSnapshot = false;
  const goals: PerfGoalRow[] = goalRows.map((r) => {
    const live = r.progress === null ? null : Math.round(Number(r.progress));
    let progress: number | null;
    if (isCurrentMonth) {
      progress = live;
    } else if (r.has_snap) {
      progress = r.snap === null ? null : Math.round(Number(r.snap));
    } else {
      progress = null;
      missingSnapshot = true;
    }
    const prevProgress = r.prev === null || r.prev === undefined ? null : Math.round(Number(r.prev));
    const lvl = (r.level === "annual" || r.period_type === "year") ? "annual"
      : (r.level === "quarter" || r.period_type === "quarter") ? "quarter" : "month";
    return {
      id: r.id, level: lvl, levelLabel: LEVEL_LABEL[lvl],
      title: r.title,
      period: r.period ?? r.period_start.slice(0, 7),
      progress,
      prevProgress,
      // 둘 다 실제 값일 때만 증감을 낸다 (§E)
      delta: progress !== null && prevProgress !== null ? progress - prevProgress : null,
      // 과거 월은 그 달 스냅샷에 굳어 있던 상태를 그대로 쓴다. 지금 다시 판정하지 않는다.
      status: isCurrentMonth
        ? (r.status_manual ?? judgeGoalStatus(progress, r.period_start, r.period_end, today))
        : (r.snap_status ?? (r.has_snap ? judgeGoalStatus(progress, r.period_start, r.period_end, b.endDate) : null)),
      manual: r.progress_manual !== null,
      projectCount: r.project_count,
    };
  });

  const measurable = goals.filter((g) => g.progress !== null);
  const goalAvg = measurable.length
    ? Math.round(measurable.reduce((a, g) => a + (g.progress as number), 0) / measurable.length)
    : null;
  const prevMeasurable = goals.filter((g) => g.prevProgress !== null);
  const goalAvgPrev = prevMeasurable.length
    ? Math.round(prevMeasurable.reduce((a, g) => a + (g.prevProgress as number), 0) / prevMeasurable.length)
    : null;

  // ── 업무 ──
  //
  // ⑥ 개인 업무는 **본인 보고서에만** 나온다 (§A3).
  //    · 팀 보고서   → 개인 업무는 애초에 팀 성과가 아니다. 전부 제외.
  //    · 개인 보고서 → 내가 나를 볼 때만 내 개인 업무가 보인다.
  //                   남의 보고서에서는 visibleTaskSql 이 알아서 걸러낸다.
  const visSql =
    scope === "personal"
      ? `AND ${visibleTaskSql(String(Number(opts.viewerId)))}`
      : `AND t.visibility = 'team'`;
  const scopeSql = scope === "personal" ? `AND t.assignee_id = $3` : ``;
  const scopeArgs = scope === "personal" ? [opts.actorId] : [];

  const completedRows = await query<TaskRaw>(
    `${TASK_SELECT}
      WHERE t.is_active = true AND t.status = 'done'
        AND t.completed_at >= $1::timestamptz AND t.completed_at < $2::timestamptz
        ${scopeSql} ${visSql}
      ORDER BY ar.sort_order NULLS LAST, ar.id, t.completed_at`,
    [b.startTs, b.nextTs, ...scopeArgs]
  );

  // 진행 중 = "그 달 말 시점에 아직 완료되지 않았던 업무".
  // 상태 이력이 없으므로 (존재 시점 + 완료 시점)으로 그 달의 사실을 복원한다.
  // 지금 열려 있다는 이유만으로 과거 달 리포트에 끼워 넣지 않는다.
  const ongoingRows = await query<TaskRaw>(
    `${TASK_SELECT}
      WHERE t.is_active = true AND t.status <> 'dropped' AND t.status <> 'proposed'
        AND t.created_at < $2::timestamptz
        AND (t.completed_at IS NULL OR t.completed_at >= $2::timestamptz)
        AND COALESCE(t.start_date, t.due_date, t.created_at::date) <= $1::date
        ${scope === "personal" ? `AND t.assignee_id = $3` : ``} ${visSql}
      ORDER BY t.due_date NULLS LAST, t.id`,
    [b.endDate, b.nextTs, ...scopeArgs]
  );

  // 다음 달 예정 = 다음 달에 시작하는 업무 (그 달 말 기준 아직 끝나지 않은 것)
  const nextRows = await query<TaskRaw>(
    `${TASK_SELECT}
      WHERE t.is_active = true AND t.status <> 'dropped' AND t.status <> 'proposed'
        AND t.start_date >= $1::date AND t.start_date <= $2::date
        AND (t.completed_at IS NULL OR t.completed_at >= $3::timestamptz)
        ${scope === "personal" ? `AND t.assignee_id = $4` : ``} ${visSql}
      ORDER BY t.start_date, t.id`,
    [b.nextStartDate, b.nextEndDate, b.nextTs, ...scopeArgs]
  );

  // ── 결정 (번복분 제외, 확정만) ──
  const decisionRows = await query<{
    id: number; title: string; rationale: string; decided_by_name: string; decided_at: string; project_name: string | null;
  }>(
    `SELECT d.id, d.title, d.rationale, a.display_name AS decided_by_name, d.decided_at::text, p.name AS project_name
       FROM decision d
       JOIN actor a ON a.id = d.decided_by
       LEFT JOIN project p ON p.id = d.project_id
      WHERE d.status = 'confirmed'
        AND d.decided_at >= $1::timestamptz AND d.decided_at < $2::timestamptz
        ${scope === "personal" ? `AND d.decided_by = $3` : ``}
      ORDER BY d.decided_at`,
    [b.startTs, b.nextTs, ...scopeArgs]
  );

  const toTask = (r: TaskRaw, carry = false): PerfTaskRow => ({
    id: r.id, title: r.title, areaName: r.area_name, projectName: r.project_name,
    assigneeName: r.assignee_name, status: r.status, progress: r.progress ?? 0,
    dueDate: r.due_date, completedAt: r.completed_at,
    carryOver: carry,
  });

  return {
    year, month, ym: b.ym,
    periodLabel: `${year}년 ${month}월`,
    docNo: `MD-M-${b.ym}`,
    scope,
    targetLabel: scope === "team" ? (opts.teamLabel ?? "플랫폼팀") : (targetName ?? "구성원"),
    generatedAt: today,
    isCurrentMonth,
    missingSnapshot,
    summary: {
      completed: completedRows.length,
      inProgress: ongoingRows.length,
      goalAvg,
      goalAvgPrev,
      goalAvgDelta: goalAvg !== null && goalAvgPrev !== null ? goalAvg - goalAvgPrev : null,
      decisions: decisionRows.length,
    },
    goals,
    completedTasks: completedRows.map((r) => toTask(r)),
    // 마감이 이 달을 넘어가면 "이월"로 표시한다
    ongoingTasks: ongoingRows.map((r) => toTask(r, !r.due_date || r.due_date > b.endDate)),
    decisions: decisionRows.map((d) => ({
      id: d.id, title: d.title, rationale: d.rationale,
      decidedByName: d.decided_by_name, decidedAt: d.decided_at, projectName: d.project_name,
    })),
    nextTasks: nextRows.map((r) => toTask(r)),
  };
}

interface TaskRaw {
  id: number; title: string; status: string; progress: number;
  due_date: string | null; completed_at: string | null;
  area_name: string | null; project_name: string | null; assignee_name: string | null;
  visibility: string;   // "개인" 칩 표시용 (§B3)
}

const TASK_SELECT = `
  SELECT t.id, t.title, t.status, t.progress, t.due_date::text, t.completed_at::text,
         ar.name AS area_name, p.name AS project_name, a.display_name AS assignee_name,
         t.visibility
    FROM task t
    LEFT JOIN area ar ON ar.id = t.area_id
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN actor a ON a.id = t.assignee_id`;
