// 팀 보고(월간 · 분기 · 연간) — 서버 쪽 (0047). 「보고」 탭이 쓴다.
//
// ── 숫자는 전부 여기서 센다 ──────────────────────────────────────
// 화면 · PDF 는 이 파일이 낸 값을 그대로 그린다. 사람이 쓰는 것은 글(설명 · 멘트 · 결정 · 이슈 · 계획)뿐이다.
//
// ── 집계 기준 (10월 보고와 같다) ─────────────────────────────────
//   · 팀 공개 · 상위 업무(체크리스트 항목은 상위에 묶인다) · 제안 · 중단 제외
//   · 기간 안 = 시작일 · 기한 · 등록일 중 하나가 기간 안
//   · 파트 = 업무의 카테고리 값: 「플랫폼」 → 플랫폼, 「R&D」 → R&D, 나머지 → 기타
//   · 기간 안에 완료로 바뀌었지만 날짜가 모두 기간 전인 업무 = 「기록 정리 필요」(실적에서 뺀다)
//   · 목표 달성률 = 그 목표(와 하위 목표)에 연결된 업무 중 완료 비율. 목표에 안 붙은 업무 = 상시업무(달성률 밖)
//
// 분기 · 연간은 기간 전체를 한 번에 센다 — 두 달에 걸친 업무를 두 번 세지 않게. 달별 · 분기별 추이는 따로 낸다.
// 확정한 보고는 이 값들을 snapshot 에 굳히고, 그 뒤로는 굳은 값을 보여 준다.
import { query, queryOne } from "./db";
import { kstToday } from "./home";

export type ReportKind = "month" | "quarter" | "year";
export type Part = "platform" | "rnd" | "etc";
export const PARTS: Part[] = ["platform", "rnd", "etc"];
export const PART_LABEL: Record<Part, string> = { platform: "플랫폼", rnd: "R&D", etc: "기타" };
export const KIND_LABEL: Record<ReportKind, string> = { month: "월간", quarter: "분기", year: "연간" };
export const PART_ORDER_KEY = "report_part_order";

export class ReportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// ── 기간 ─────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1~12
export function periodOf(kind: ReportKind, anyDay: string): { start: string; end: string } {
  const y = Number(anyDay.slice(0, 4)), m = Number(anyDay.slice(5, 7));
  if (kind === "year") return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (kind === "quarter") { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return { start: `${y}-${pad(q0)}-01`, end: `${y}-${pad(q0 + 2)}-${lastDay(y, q0 + 2)}` }; }
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${lastDay(y, m)}` };
}
export function periodLabel(kind: ReportKind, start: string): string {
  const y = start.slice(0, 4), m = Number(start.slice(5, 7));
  return kind === "year" ? `${y}년` : kind === "quarter" ? `${y}년 ${Math.floor((m - 1) / 3) + 1}분기` : `${y}년 ${m}월`;
}
function addMonths(start: string, n: number): string {
  const d = new Date(`${start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
const STEP: Record<ReportKind, number> = { month: 1, quarter: 3, year: 12 };
export const nextPeriod = (kind: ReportKind, start: string) => periodOf(kind, addMonths(start, STEP[kind]));
export const prevPeriod = (kind: ReportKind, start: string) => periodOf(kind, addMonths(start, -STEP[kind]));
/** 분기 → 그 석 달, 연간 → 네 분기 */
export function subPeriods(kind: ReportKind, start: string): { kind: ReportKind; start: string; end: string }[] {
  if (kind === "month") return [];
  const sub: ReportKind = kind === "quarter" ? "month" : "quarter";
  const n = kind === "quarter" ? 3 : 4;
  return Array.from({ length: n }, (_, i) => ({ kind: sub, ...periodOf(sub, addMonths(start, i * STEP[sub])) }));
}
export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// ── 업무 ─────────────────────────────────────────────────────────
const BASE = `t.is_active AND t.parent_task_id IS NULL AND t.visibility = 'team' AND t.status NOT IN ('proposed', 'dropped')`;
const CREATED = `(t.created_at AT TIME ZONE 'Asia/Seoul')::date`;
const DONE_ON = `(t.completed_at AT TIME ZONE 'Asia/Seoul')::date`;
const IN_PERIOD = (s: string, e: string) => `(t.start_date BETWEEN ${s} AND ${e} OR t.due_date BETWEEN ${s} AND ${e} OR ${CREATED} BETWEEN ${s} AND ${e})`;
const PART_SQL = `CASE ar.name WHEN '플랫폼' THEN 'platform' WHEN 'R&D' THEN 'rnd' ELSE 'etc' END`;

export interface RTask {
  id: number; title: string; status: string; part: Part; area: string;
  assigneeId: number | null; assignee: string | null;
  start: string | null; due: string | null; done: string | null; created: string;
  checks: string | null; description: string; goalIds: number[];
}
const TASK_COLS = `t.id, t.title, t.status, ${PART_SQL} AS part, ar.name AS area, t.assignee_id, a.display_name AS assignee,
  t.start_date::text AS start, t.due_date::text AS due, ${DONE_ON}::text AS done_on, ${CREATED}::text AS created, t.description,
  (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND c.is_active AND c.status <> 'dropped') AS kids,
  (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND c.is_active AND c.status = 'done') AS kids_done,
  COALESCE((SELECT array_agg(gt.goal_id) FROM goal_task gt WHERE gt.task_id = t.id), '{}') AS goal_ids`;
const TASK_FROM = `FROM task t JOIN area ar ON ar.id = t.area_id LEFT JOIN actor a ON a.id = t.assignee_id`;
type TaskRow = { id: number; title: string; status: string; part: Part; area: string; assignee_id: number | null; assignee: string | null;
  start: string | null; due: string | null; done_on: string | null; created: string; description: string | null; kids: number; kids_done: number; goal_ids: number[] };
const toTask = (r: TaskRow): RTask => ({
  id: r.id, title: r.title, status: r.status, part: r.part, area: r.area, assigneeId: r.assignee_id, assignee: r.assignee,
  start: r.start, due: r.due, done: r.status === "done" ? r.done_on : null, created: r.created,
  checks: r.kids ? `${r.kids_done}/${r.kids}` : null, description: (r.description ?? "").slice(0, 600), goalIds: r.goal_ids ?? [],
});
const ORDER = `ORDER BY CASE t.status WHEN 'done' THEN 0 WHEN 'doing' THEN 1 WHEN 'review' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END,
  COALESCE(${DONE_ON}, t.due_date, t.start_date, ${CREATED}), t.id`;

export async function tasksInPeriod(s: string, e: string): Promise<RTask[]> {
  return (await query<TaskRow>(`SELECT ${TASK_COLS} ${TASK_FROM} WHERE ${BASE} AND ${IN_PERIOD("$1::date", "$2::date")} ${ORDER}`, [s, e])).map(toTask);
}
/** 기간 안에 완료로 바뀌었지만 날짜가 모두 기간 전 — 실적에서 빼고 「기록 정리 필요」로 */
export async function tidyInPeriod(s: string, e: string): Promise<RTask[]> {
  return (await query<TaskRow>(
    `SELECT ${TASK_COLS} ${TASK_FROM} WHERE ${BASE} AND t.status = 'done' AND ${DONE_ON} BETWEEN $1::date AND $2::date
        AND NOT ${IN_PERIOD("$1::date", "$2::date")} ${ORDER}`, [s, e])).map(toTask);
}
/** 다음 기간 계획 — 기한이 다음 기간인 안 끝난 업무 */
export async function tasksDueIn(s: string, e: string): Promise<RTask[]> {
  return (await query<TaskRow>(
    `SELECT ${TASK_COLS} ${TASK_FROM} WHERE ${BASE} AND t.status <> 'done' AND t.due_date BETWEEN $1::date AND $2::date ORDER BY t.due_date, t.id`, [s, e])).map(toTask);
}

export interface Counts { total: number; done: number; doing: number; hold: number; todo: number }
const bucket = (st: string) => (st === "done" ? "done" : st === "doing" || st === "review" ? "doing" : st === "hold" ? "hold" : "todo");
export function countOf(ts: RTask[]): Counts {
  const c: Counts = { total: ts.length, done: 0, doing: 0, hold: 0, todo: 0 };
  for (const t of ts) c[bucket(t.status)]++;
  return c;
}

// ── 목표 달성률 ──────────────────────────────────────────────────
export interface GoalRate { id: number; title: string; done: number; total: number; rate: number | null }
export interface LevelRate { level: "year" | "quarter" | "month"; done: number; total: number; rate: number | null; goals: GoalRate[] }
const rateOf = (d: number, t: number) => (t ? Math.round((d / t) * 100) : null);

export async function goalRates(s: string, e: string): Promise<LevelRate[]> {
  const goals = await query<{ id: number; title: string; period_type: "year" | "quarter" | "month" }>(
    `SELECT id, title, period_type FROM goal
      WHERE is_active AND scope = 'team' AND period_start <= $2::date AND period_end >= $1::date
      ORDER BY CASE period_type WHEN 'year' THEN 0 WHEN 'quarter' THEN 1 ELSE 2 END, period_start, id`, [s, e]);
  const links = goals.length ? await query<{ root: number; task_id: number; status: string }>(
    `WITH RECURSIVE g AS (
       SELECT id, id AS root FROM goal WHERE id = ANY($1::int[])
       UNION ALL SELECT c.id, g.root FROM goal c JOIN g ON c.parent_id = g.id WHERE c.is_active)
     SELECT DISTINCT g.root, t.id AS task_id, t.status FROM g
       JOIN goal_task gt ON gt.goal_id = g.id JOIN task t ON t.id = gt.task_id
      WHERE ${BASE} AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled', 'duplicate'))`, [goals.map((g) => g.id)]) : [];
  return (["year", "quarter", "month"] as const).map((level) => {
    const gs = goals.filter((g) => g.period_type === level);
    const all = new Map<number, string>();
    const per = gs.map((g) => {
      const ls = links.filter((l) => l.root === g.id);
      ls.forEach((l) => all.set(l.task_id, l.status));
      const d = ls.filter((l) => l.status === "done").length;
      return { id: g.id, title: g.title, done: d, total: ls.length, rate: rateOf(d, ls.length) };
    });
    const done = Array.from(all.values()).filter((x) => x === "done").length;
    return { level, done, total: all.size, rate: rateOf(done, all.size), goals: per };
  });
}

// ── 한 보고의 숫자 전부 ──────────────────────────────────────────
export interface Agg {
  counts: Counts;
  parts: Record<Part, Counts>;
  people: { id: number | null; name: string; counts: Counts }[];
  routine: number;                 // 목표에 안 붙은 업무 = 상시업무
  goals: LevelRate[];
  trend: { label: string; start: string; counts: Counts; status: "final" | "draft" | "none"; reportId: number | null }[];
  tasks: RTask[];                  // 기간 안 업무(종합표 · 업무 넣기 후보)
  tidy: RTask[];                   // 기록 정리 필요
  autoPlans: RTask[];              // 다음 기간에 기한이 걸린 업무
}

export async function aggregate(kind: ReportKind, s: string, e: string): Promise<Agg> {
  const nx = nextPeriod(kind, s);
  const [tasks, tidy, goals, autoPlans] = await Promise.all([tasksInPeriod(s, e), tidyInPeriod(s, e), goalRates(s, e), tasksDueIn(nx.start, nx.end)]);
  const parts = Object.fromEntries(PARTS.map((p) => [p, countOf(tasks.filter((t) => t.part === p))])) as Record<Part, Counts>;
  const byP = new Map<string, { id: number | null; name: string; ts: RTask[] }>();
  for (const t of tasks) {
    const k = String(t.assigneeId ?? "none");
    if (!byP.has(k)) byP.set(k, { id: t.assigneeId, name: t.assignee ?? "담당 없음", ts: [] });
    byP.get(k)!.ts.push(t);
  }
  const people = Array.from(byP.values()).map((p) => ({ id: p.id, name: p.name, counts: countOf(p.ts) })).sort((a, b) => b.counts.total - a.counts.total);
  const trend: Agg["trend"] = [];
  for (const sp of subPeriods(kind, s)) {
    const r = await queryOne<{ id: number; status: "final" | "draft"; snapshot: { agg?: { counts?: Counts } } | null }>(
      `SELECT id, status, snapshot FROM team_report WHERE is_active AND kind = $1 AND period_start = $2::date`, [sp.kind, sp.start]);
    const counts = r?.status === "final" && r.snapshot?.agg?.counts ? r.snapshot.agg.counts : countOf(await tasksInPeriod(sp.start, sp.end));
    trend.push({ label: periodLabel(sp.kind, sp.start).replace(/^\d{4}년 /, ""), start: sp.start, counts, status: r?.status ?? "none", reportId: r?.id ?? null });
  }
  return {
    counts: countOf(tasks), parts, people, routine: tasks.filter((t) => t.goalIds.length === 0).length,
    goals, trend, tasks, tidy, autoPlans,
  };
}

// ── 보고 ─────────────────────────────────────────────────────────
export interface ReportRow {
  id: number; kind: ReportKind; period_start: string; period_end: string; title: string; status: "draft" | "final";
  part_order: Part[]; headline: string; snapshot: Snapshot | null; pdf_path: string | null;
  finalized_at: string | null; finalized_by_name: string | null; created_by: number; created_at: string; updated_at: string;
}
export interface Snapshot { at: string; agg: Agg; items: Record<number, RTask>; prevPlans: PrevPlan[] }
export interface PrevPlan { kind: "task" | "manual"; id: number; body: string; status: string; assignee: string | null; due: string | null }

export const REPORT_COLS = `r.id, r.kind, r.period_start::text, r.period_end::text, r.title, r.status, r.part_order, r.headline, r.snapshot, r.pdf_path,
  r.finalized_at::text, f.display_name AS finalized_by_name, r.created_by, r.created_at::text, r.updated_at::text`;
export async function getReportRow(id: number): Promise<ReportRow | null> {
  return queryOne<ReportRow>(`SELECT ${REPORT_COLS} FROM team_report r LEFT JOIN actor f ON f.id = r.finalized_by WHERE r.id = $1 AND r.is_active`, [id]);
}

export async function teamPartOrder(): Promise<Part[]> {
  const r = await queryOne<{ value: unknown }>(`SELECT value FROM config WHERE key = $1`, [PART_ORDER_KEY]);
  return normalizeOrder(r?.value);
}
export function normalizeOrder(v: unknown): Part[] {
  const xs = Array.isArray(v) ? v.filter((x): x is Part => (PARTS as string[]).includes(String(x))) : [];
  const uniq = Array.from(new Set(xs));
  return uniq.length === 3 ? uniq : [...PARTS];
}

/** 지난 보고의 「다음 계획」 — 업무로 걸린 것은 지금 상태, 손으로 적은 것은 그 줄의 상태 */
export async function prevPlans(kind: ReportKind, start: string): Promise<PrevPlan[]> {
  const pv = prevPeriod(kind, start);
  const prev = await queryOne<{ id: number; status: string; snapshot: Snapshot | null }>(
    `SELECT id, status, snapshot FROM team_report WHERE is_active AND kind = $1 AND period_start = $2::date`, [kind, pv.start]);
  if (!prev) return [];
  const planTasks = prev.status === "final" && prev.snapshot?.agg?.autoPlans
    ? prev.snapshot.agg.autoPlans.map((t) => t.id)
    : (await tasksDueIn(start, periodOf(kind, start).end)).map((t) => t.id);
  const live = planTasks.length ? await query<{ id: number; title: string; status: string; assignee: string | null; due: string | null }>(
    `SELECT t.id, t.title, t.status, a.display_name AS assignee, t.due_date::text AS due FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
      WHERE t.id = ANY($1::int[]) AND t.is_active`, [planTasks]) : [];
  const manual = await query<{ id: number; body: string; status: string }>(
    `SELECT id, body, status FROM team_report_plan WHERE report_id = $1 AND is_active ORDER BY sort_order, id`, [prev.id]);
  return [
    ...live.map((t) => ({ kind: "task" as const, id: t.id, body: t.title, status: t.status, assignee: t.assignee, due: t.due })),
    ...manual.map((m) => ({ kind: "manual" as const, id: m.id, body: m.body, status: m.status, assignee: null, due: null })),
  ];
}

/** 분기 · 연간 — 그 안의 하위 보고 중 확정 안 된 것(없는 것 포함) */
export async function unfinishedSubs(kind: ReportKind, start: string): Promise<string[]> {
  const out: string[] = [];
  for (const sp of subPeriods(kind, start)) {
    const r = await queryOne<{ status: string }>(`SELECT status FROM team_report WHERE is_active AND kind = $1 AND period_start = $2::date`, [sp.kind, sp.start]);
    if (r?.status !== "final") out.push(`${periodLabel(sp.kind, sp.start)} ${r ? "작성중" : "없음"}`);
  }
  return out;
}

export const todayKst = kstToday;

/** 보고 항목이 가리키는 업무의 지금 값 — 팀 공개만(그사이 개인으로 바뀐 업무는 빠진다) */
export async function tasksByIds(ids: number[]): Promise<Map<number, RTask>> {
  if (!ids.length) return new Map();
  const rows = await query<TaskRow>(`SELECT ${TASK_COLS} ${TASK_FROM} WHERE t.id = ANY($1::int[]) AND t.visibility = 'team'`, [ids]);
  return new Map(rows.map((r) => [r.id, toTask(r)]));
}
