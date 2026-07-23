// 월간 보고 집계 (Phase 7) — 모든 수치는 DB 쿼리로 산출한다. LLM은 문장화만 (SPEC 3.2).
// 진척 산식은 lib/goals.ts(dropped 제외)를 그대로 사용하고 여기서 재계산하지 않는다.
// 기간 경계는 Asia/Seoul 고정 — Vercel(UTC)에서도 KST 월 경계로 정확히 자른다.
import { query } from "./db";
import { getCurrentMonthGoals } from "./goals";

const KST = "+09:00";

export interface ReportTaskRef {
  id: number;
  title: string;
  projectName: string | null;
  assigneeName: string | null;
  goalTitles: string[];
  dueDate: string | null;
  completedAt: string | null;
  dropReason: string | null;
}

export interface ReportGoalRef {
  id: number;
  title: string;
  progress: number | null;
  projectName: string | null;
  droppedCount: number;
}

export interface ReportSignalRef {
  id: number;
  type: string;
  title: string;
  authorName: string;
  status: string;
  decidedAt: string | null;
  resolvedAt: string | null;
  /** 결정 후 경과일 — 미실행 결정에만 채워짐 (개선 1). 생성 시점에 고정 */
  decidedElapsedDays?: number | null;
}

/** 화면 렌더 시 항목 수 대조용 — 조용한 누락 감지 (D-013, 치명1 조치) */
export interface ReportCounts {
  goals: number;
  completed: number;
  incomplete: number;
  dropped: number;
  decisions: number;
  pendingDecisions: number;
  risks: number;
  nextGoals: number;
  nextTasks: number;
}

/** 서버가 계산한 요약 수치 — LLM은 이 값만 문장에 끼워넣는다 (치명2 조치) */
export interface ReportSummary {
  totalGoals: number;
  goalsBelow30: number; // 진척 30% 미만(산출 가능한 것 중)
  goalsUnmeasured: number; // 진척 산출 불가("-")
  avgProgress: number | null; // 산출 가능한 목표 평균(정수)
  completedCount: number;
  incompleteCount: number;
  droppedCount: number;
  decisionsCount: number;
  pendingDecisionsCount: number;
  risksCount: number;
  nextGoalsCount: number;
  nextTasksCount: number;
}

export interface MonthlyReportData {
  year: number;
  month: number;
  periodLabel: string; // "2026년 7월"
  goals: ReportGoalRef[];
  completed: ReportTaskRef[];
  incomplete: ReportTaskRef[];
  dropped: ReportTaskRef[];
  decisions: ReportSignalRef[];
  pendingDecisions: ReportSignalRef[]; // 월말 기준 미실행 결정
  risks: ReportSignalRef[];
  nextGoals: ReportGoalRef[];
  nextTasks: ReportTaskRef[];
  counts: ReportCounts; // 렌더 대조용
  summary: ReportSummary; // LLM 문장화용 서버 계산값
}

/** KST 기준 월 경계 — [start, nextStart) 반개구간의 timestamptz 문자열 */
function monthBounds(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-01T00:00:00${KST}`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const nextStart = `${ny}-${pad(nm)}-01T00:00:00${KST}`;
  const midDay = `${year}-${pad(month)}-15`; // 월 목표 조회용 (period 포함 판정)
  const nextMid = `${ny}-${pad(nm)}-15`;
  return { start, nextStart, midDay, nextMid, ny, nm };
}

export async function buildMonthlyReport(year: number, month: number): Promise<MonthlyReportData> {
  const { start, nextStart, midDay, nextMid, ny, nm } = monthBounds(year, month);

  // 1. 목표 — lib/goals.ts의 dropped 제외 진척을 그대로 사용
  const monthGoals = await getCurrentMonthGoals(midDay);
  const goals: ReportGoalRef[] = monthGoals.map((g) => ({
    id: g.id,
    title: g.title,
    progress: g.progress,
    projectName: g.projectName,
    droppedCount: g.droppedCount,
  }));

  // 공통: Task + 연결 목표 제목
  const taskSelect = `
    SELECT t.id, t.title, p.name AS project_name, a.display_name AS assignee_name,
           t.due_date::text, t.completed_at::text, t.drop_reason,
           array_agg(g.title) FILTER (WHERE g.title IS NOT NULL) AS goal_titles
    FROM task t
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN actor a ON a.id = t.assignee_id
    LEFT JOIN goal_task gt ON gt.task_id = t.id
    LEFT JOIN goal g ON g.id = gt.goal_id AND g.is_active = true`;
  const mapTask = (r: any): ReportTaskRef => ({
    id: r.id,
    title: r.title,
    projectName: r.project_name,
    assigneeName: r.assignee_name,
    goalTitles: r.goal_titles ?? [],
    dueDate: r.due_date,
    completedAt: r.completed_at,
    dropReason: r.drop_reason,
  });

  // 2. 완료 — status='done'이고 completed_at이 해당 월 (KST)
  const completed = (
    await query(
      `${taskSelect}
       WHERE t.is_active = true AND t.status = 'done'
         AND t.completed_at >= $1::timestamptz AND t.completed_at < $2::timestamptz
       GROUP BY t.id, p.name, a.display_name
       ORDER BY t.completed_at`,
      [start, nextStart]
    )
  ).map(mapTask);

  // 3. 미완료 — 기한이 해당 월인데 아직 done/dropped 아님
  const incomplete = (
    await query(
      `${taskSelect}
       WHERE t.is_active = true AND t.status NOT IN ('done','dropped','proposed')
         AND t.due_date >= ($1::timestamptz)::date AND t.due_date < ($2::timestamptz)::date
       GROUP BY t.id, p.name, a.display_name
       ORDER BY t.due_date`,
      [start, nextStart]
    )
  ).map(mapTask);

  // 4. 중단 — dropped_at이 해당 월 (drop_reason 포함)
  const dropped = (
    await query(
      `${taskSelect}
       WHERE t.is_active = true AND t.status = 'dropped'
         AND t.dropped_at >= $1::timestamptz AND t.dropped_at < $2::timestamptz
       GROUP BY t.id, p.name, a.display_name
       ORDER BY t.dropped_at`,
      [start, nextStart]
    )
  ).map(mapTask);

  // 5. 결정 — 해당 월에 decided 또는 resolved로 전환된 decision
  const decisions = (
    await query<ReportSignalRow>(
      `SELECT s.id, s.type, s.title, a.display_name AS author_name, s.status,
              s.decided_at::text, s.resolved_at::text
       FROM signal s JOIN actor a ON a.id = s.author_id
       WHERE s.is_active = true AND s.type = 'decision'
         AND (
           (s.decided_at >= $1::timestamptz AND s.decided_at < $2::timestamptz)
           OR (s.resolved_at >= $1::timestamptz AND s.resolved_at < $2::timestamptz)
         )
       ORDER BY COALESCE(s.resolved_at, s.decided_at)`,
      [start, nextStart]
    )
  ).map(mapSignal);

  // 6. 미실행 결정 — 월말(nextStart) 시점에 decided 상태로 남아 있던 것 (point-in-time)
  //    경과일은 생성 시점 기준으로 고정 저장 (개선 1)
  const pendingDecisions = (
    await query<ReportSignalRow & { decided_elapsed: string | null }>(
      `SELECT s.id, s.type, s.title, a.display_name AS author_name, s.status,
              s.decided_at::text, s.resolved_at::text,
              floor(EXTRACT(EPOCH FROM (now() - s.decided_at)) / 86400) AS decided_elapsed
       FROM signal s JOIN actor a ON a.id = s.author_id
       WHERE s.is_active = true AND s.type = 'decision'
         AND s.decided_at IS NOT NULL AND s.decided_at < $1::timestamptz
         AND (s.resolved_at IS NULL OR s.resolved_at >= $1::timestamptz)
       ORDER BY s.decided_at`,
      [nextStart]
    )
  ).map((r) => ({
    ...mapSignal(r),
    decidedElapsedDays: r.decided_elapsed === null ? null : Number(r.decided_elapsed),
  }));

  // 7. 리스크 — 해당 월 생성된 risk
  const risks = (
    await query<ReportSignalRow>(
      `SELECT s.id, s.type, s.title, a.display_name AS author_name, s.status,
              s.decided_at::text, s.resolved_at::text
       FROM signal s JOIN actor a ON a.id = s.author_id
       WHERE s.is_active = true AND s.type = 'risk'
         AND s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz
       ORDER BY s.created_at`,
      [start, nextStart]
    )
  ).map(mapSignal);

  // 8. 다음 달 목표 — 다음 달 월 목표 (진척은 참고용)
  const nextMonthGoals = await getCurrentMonthGoals(nextMid);
  const nextGoals: ReportGoalRef[] = nextMonthGoals.map((g) => ({
    id: g.id,
    title: g.title,
    progress: g.progress,
    projectName: g.projectName,
    droppedCount: g.droppedCount,
  }));

  // 9. 다음 달 예정 Task — 기한이 다음 달
  const { start: nextMonthStart, nextStart: afterNext } = monthBounds(ny, nm);
  const nextTasks = (
    await query(
      `${taskSelect}
       WHERE t.is_active = true AND t.status NOT IN ('done','dropped','proposed')
         AND t.due_date >= ($1::timestamptz)::date AND t.due_date < ($2::timestamptz)::date
       GROUP BY t.id, p.name, a.display_name
       ORDER BY t.due_date`,
      [nextMonthStart, afterNext]
    )
  ).map(mapTask);

  // 렌더 대조용 count — 목록 쿼리와 독립된 COUNT(*)로 재측정한다.
  // 목록 배열 길이와 이 값이 다르면 화면이 경고 배너를 띄운다 (조용한 누락 감지, 치명1 조치).
  const countOne = async (sql: string, p: unknown[]) =>
    Number((await query<{ n: string }>(sql, p))[0]?.n ?? 0);
  const [cCompleted, cIncomplete, cDropped, cDecisions, cPending, cRisks, cNextTasks] = await Promise.all([
    countOne(
      `SELECT count(*) AS n FROM task WHERE is_active AND status='done'
         AND completed_at >= $1::timestamptz AND completed_at < $2::timestamptz`,
      [start, nextStart]
    ),
    countOne(
      `SELECT count(*) AS n FROM task WHERE is_active AND status NOT IN ('done','dropped','proposed')
         AND due_date >= ($1::timestamptz)::date AND due_date < ($2::timestamptz)::date`,
      [start, nextStart]
    ),
    countOne(
      `SELECT count(*) AS n FROM task WHERE is_active AND status='dropped'
         AND dropped_at >= $1::timestamptz AND dropped_at < $2::timestamptz`,
      [start, nextStart]
    ),
    countOne(
      `SELECT count(*) AS n FROM signal WHERE is_active AND type='decision'
         AND ((decided_at >= $1::timestamptz AND decided_at < $2::timestamptz)
           OR (resolved_at >= $1::timestamptz AND resolved_at < $2::timestamptz))`,
      [start, nextStart]
    ),
    countOne(
      `SELECT count(*) AS n FROM signal WHERE is_active AND type='decision'
         AND decided_at IS NOT NULL AND decided_at < $1::timestamptz
         AND (resolved_at IS NULL OR resolved_at >= $1::timestamptz)`,
      [nextStart]
    ),
    countOne(
      `SELECT count(*) AS n FROM signal WHERE is_active AND type='risk'
         AND created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
      [start, nextStart]
    ),
    countOne(
      `SELECT count(*) AS n FROM task WHERE is_active AND status NOT IN ('done','dropped','proposed')
         AND due_date >= ($1::timestamptz)::date AND due_date < ($2::timestamptz)::date`,
      [nextMonthStart, afterNext]
    ),
  ]);

  // LLM 문장화용 summary — 모두 서버 계산
  const measurable = goals.filter((g) => g.progress !== null) as { progress: number }[];
  const summary: ReportSummary = {
    totalGoals: goals.length,
    goalsBelow30: measurable.filter((g) => g.progress < 30).length,
    goalsUnmeasured: goals.filter((g) => g.progress === null).length,
    avgProgress:
      measurable.length > 0
        ? Math.round(measurable.reduce((s, g) => s + g.progress, 0) / measurable.length)
        : null,
    completedCount: completed.length,
    incompleteCount: incomplete.length,
    droppedCount: dropped.length,
    decisionsCount: decisions.length,
    pendingDecisionsCount: pendingDecisions.length,
    risksCount: risks.length,
    nextGoalsCount: nextGoals.length,
    nextTasksCount: nextTasks.length,
  };
  // goals/nextGoals는 getCurrentMonthGoals가 행 1:1 매핑이라 배열 길이가 곧 authoritative count.
  // 나머지는 위 독립 COUNT(*) 결과를 사용 — 목록 배열과 다르면 화면이 경고한다.
  const counts: ReportCounts = {
    goals: goals.length,
    completed: cCompleted,
    incomplete: cIncomplete,
    dropped: cDropped,
    decisions: cDecisions,
    pendingDecisions: cPending,
    risks: cRisks,
    nextGoals: nextGoals.length,
    nextTasks: cNextTasks,
  };

  return {
    year,
    month,
    periodLabel: `${year}년 ${month}월`,
    goals,
    completed,
    incomplete,
    dropped,
    decisions,
    pendingDecisions,
    risks,
    nextGoals,
    nextTasks,
    counts,
    summary,
  };
}

// SPEC 3.2 — 6개 섹션 고정 순서. 화면·PPTX·Notion이 이 정의를 공유한다.
export const REPORT_SECTIONS: { key: string; title: string; hint: string }[] = [
  { key: "goals", title: "이번 달 목표 달성 현황", hint: "월 목표별 진척률을 요약" },
  { key: "completed", title: "주요 수행 실적", hint: "완료한 업무를 목표별로 묶어 요약" },
  { key: "incomplete", title: "미달 항목 및 사유", hint: "미완료·중단 업무와 사유를 요약" },
  { key: "decisions", title: "주요 결정 사항", hint: "확정된 결정과 미실행 결정을 구분해 요약" },
  { key: "risks", title: "리스크 및 이슈", hint: "이번 달 제기된 리스크를 요약" },
  { key: "next", title: "다음 달 목표 및 계획", hint: "다음 달 목표와 예정 업무를 요약" },
];

const pct = (n: number | null) => (n === null ? "-" : `${n}%`);

/** 승인 시 Notion에 기록할 마크다운 — 서버 수치 + LLM 서술 결합 (LLM은 수치 미생성) */
export function renderReportMarkdown(
  data: MonthlyReportData,
  narration: Record<string, string>
): string {
  const L: string[] = [`# ${data.periodLabel} 월간 보고`, ""];
  const para = (key: string) => {
    if (narration[key]?.trim()) L.push(narration[key].trim(), "");
  };

  L.push("## 1. 이번 달 목표 달성 현황", "");
  para("goals");
  if (data.goals.length === 0) L.push("- 해당 월 목표 없음");
  for (const g of data.goals) {
    L.push(`- ${g.title}: ${pct(g.progress)}${g.droppedCount > 0 ? ` (중단 ${g.droppedCount}건)` : ""}`);
  }
  L.push("");

  L.push("## 2. 주요 수행 실적", "");
  para("completed");
  if (data.completed.length === 0) L.push("- 완료 업무 없음");
  for (const t of data.completed) {
    L.push(`- ${t.title}${t.goalTitles.length ? ` [${t.goalTitles.join(", ")}]` : ""}${t.assigneeName ? ` — ${t.assigneeName}` : ""}`);
  }
  L.push("");

  L.push("## 3. 미달 항목 및 사유", "");
  para("incomplete");
  if (data.incomplete.length === 0 && data.dropped.length === 0) L.push("- 미달·중단 항목 없음");
  for (const t of data.incomplete) L.push(`- (미완료) ${t.title}${t.dueDate ? ` — 기한 ${t.dueDate}` : ""}`);
  for (const t of data.dropped) L.push(`- (중단) ${t.title} — ${t.dropReason ?? "사유 미기재"}`);
  L.push("");

  L.push("## 4. 주요 결정 사항", "");
  para("decisions");
  if (data.decisions.length === 0) L.push("- 결정 사항 없음");
  for (const s of data.decisions) L.push(`- ${s.title}${s.status === "resolved" ? " (반영됨)" : " (결정됨)"}`);
  if (data.pendingDecisions.length > 0) {
    L.push("", "**미실행 결정 (결정됐으나 업무로 반영되지 않음):**");
    for (const s of data.pendingDecisions) {
      const when = s.decidedAt ? s.decidedAt.slice(0, 10) : "?";
      const elapsed = s.decidedElapsedDays != null ? `, ${s.decidedElapsedDays}일 경과` : "";
      L.push(`- ${s.title} (${when} 결정${elapsed})`);
    }
  }
  L.push("");

  L.push("## 5. 리스크 및 이슈", "");
  para("risks");
  if (data.risks.length === 0) L.push("- 리스크 없음");
  for (const s of data.risks) L.push(`- ${s.title} (${s.status})`);
  L.push("");

  L.push("## 6. 다음 달 목표 및 계획", "");
  para("next");
  if (data.nextGoals.length === 0) {
    L.push("- 다음 달 목표가 아직 설정되지 않았습니다. 목표 화면에서 설정하세요.");
  } else {
    for (const g of data.nextGoals) L.push(`- (목표) ${g.title}`);
  }
  for (const t of data.nextTasks) L.push(`- (예정) ${t.title}${t.dueDate ? ` — ${t.dueDate}` : ""}`);

  return L.join("\n");
}

interface ReportSignalRow {
  id: number;
  type: string;
  title: string;
  author_name: string;
  status: string;
  decided_at: string | null;
  resolved_at: string | null;
}

function mapSignal(r: ReportSignalRow): ReportSignalRef {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    authorName: r.author_name,
    status: r.status,
    decidedAt: r.decided_at,
    resolvedAt: r.resolved_at,
  };
}
