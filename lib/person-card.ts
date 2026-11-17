// 팀원 상세 · 개인 성과 카드 (2026-11 모니터링) — 숫자는 전부 서버가 센다. 화면은 그리기만 한다.
//
// 누가 보나: 팀장은 누구든, 팀원은 자기 것만(`/api/ed/people/[id]` 가 막는다).
// 무엇을 세나(기간 = 그 달 또는 그 분기, KST):
//   · 지금 — 열린 업무(시작 전 · 진행 · 검토 · 보류) · 지남 · 함께하는 업무
//   · 기간 — 완료 · 기한 준수(완료일 ≤ 기한) · 처리 기간 중앙값 · 목표에 걸린 완료 · 업무일지 쓴 날 / 평일
//   · 주별 완료(기간 안의 주) · 최근 업무일지 · 최근 활동 · 월간 보고 상태
// 업무는 상위 업무만(체크리스트 = 하위 업무는 빼고), 보는 사람에게 보이는 것만 센다.
import { query } from "./db";
import { visibleTaskSql } from "./visibility";

export type PeriodKind = "month" | "quarter";
export interface PersonCard {
  person: { id: number; name: string; role: string | null };
  period: { kind: PeriodKind; start: string; end: string; label: string };
  today: string;
  now: { open: number; over: number; doing: number; review: number; hold: number; with: number };
  kpi: { done: number; onTime: number; late: number; noDue: number; cycleMedian: number | null; goalDone: number; logDays: number; workDays: number; lastLog: string | null };
  weeks: { label: string; start: string; n: number }[];
  open: { id: number; title: string; status: string; due: string | null; area: string; over: boolean }[];
  done: { id: number; title: string; doneOn: string; due: string | null; area: string; late: boolean }[];
  logs: { id: number; loggedOn: string; body: string; cat: string | null; taskId: number | null }[];
  activity: { message: string; at: string }[];
  monthly: { month: string; status: string; submittedAt: string | null; readAt: string | null; comment: string | null }[];
}

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthEnd = (ym: string) => `${ym}-${String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;
const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export function periodOf(kind: PeriodKind, at: string): { start: string; end: string; label: string } {
  const y = at.slice(0, 4), m = Number(at.slice(5, 7));
  if (kind === "quarter") {
    const q = Math.ceil(m / 3), sm = (q - 1) * 3 + 1;
    return { start: `${y}-${String(sm).padStart(2, "0")}-01`, end: monthEnd(`${y}-${String(sm + 2).padStart(2, "0")}`), label: `${y}년 ${q}분기` };
  }
  return { start: `${at.slice(0, 7)}-01`, end: monthEnd(at.slice(0, 7)), label: `${y}년 ${m}월` };
}

export async function personCard(personId: number, viewerId: number, kind: PeriodKind, at: string, today: string): Promise<PersonCard | null> {
  const p = (await query<{ id: number; name: string; role: string | null }>(
    `SELECT a.id, a.display_name AS name, ac.role FROM actor a LEFT JOIN account ac ON ac.actor_id = a.id WHERE a.id = $1 AND a.type = 'human'`, [personId]))[0];
  if (!p) return null;
  const per = periodOf(kind, at);
  const [tasks, withN, logs, logDays, act, monthly] = await Promise.all([
    query<{ id: number; title: string; status: string; due: string | null; start_on: string | null; made_on: string; done_on: string | null; area: string; goals: number }>(
      `SELECT t.id, t.title, t.status, t.due_date::text AS due, t.start_date::text AS start_on,
              (t.created_at AT TIME ZONE 'Asia/Seoul')::date::text AS made_on,
              ((t.completed_at AT TIME ZONE 'Asia/Seoul')::date)::text AS done_on, ar.name AS area,
              (SELECT count(*)::int FROM goal_task gt WHERE gt.task_id = t.id) AS goals
         FROM task t JOIN area ar ON ar.id = t.area_id
        WHERE t.is_active AND t.parent_task_id IS NULL AND t.assignee_id = $1 AND t.status NOT IN ('proposed','dropped')
          AND ${visibleTaskSql("$2")}`, [personId, viewerId]),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM task_member m JOIN task t ON t.id = m.task_id
        WHERE m.actor_id = $1 AND m.is_active AND t.is_active AND t.status IN ('todo','doing','review','hold') AND ${visibleTaskSql("$2")}`, [personId, viewerId]),
    query<{ id: number; logged_on: string; body: string; cat: string | null; task_id: number | null }>(
      `SELECT w.id, w.logged_on::text, w.body, c.name AS cat, w.task_id FROM work_log w LEFT JOIN work_log_category c ON c.id = w.category_id
        WHERE w.owner_actor_id = $1 AND w.is_active AND w.logged_on BETWEEN $2::date AND $3::date
        ORDER BY w.logged_on DESC, w.id DESC LIMIT 40`, [personId, per.start, per.end]),
    query<{ d: string }>(
      `SELECT DISTINCT logged_on::text AS d FROM work_log WHERE owner_actor_id = $1 AND is_active AND logged_on BETWEEN $2::date AND $3::date
       UNION SELECT DISTINCT ((completed_at AT TIME ZONE 'Asia/Seoul')::date)::text FROM task
        WHERE assignee_id = $1 AND is_active AND status = 'done' AND (completed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $2::date AND $3::date`,
      [personId, per.start, per.end]),
    query<{ message: string; at: string }>(
      `SELECT message, created_at::text AS at FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15`, [personId]),
    query<{ month: string; status: string; submitted_at: string | null; lead_read_at: string | null; lead_comment: string | null }>(
      `SELECT month, status, submitted_at::text, lead_read_at::text, lead_comment FROM monthly_report
        WHERE actor_id = $1 AND month BETWEEN $2 AND $3 ORDER BY month`, [personId, per.start.slice(0, 7), per.end.slice(0, 7)]),
  ]);

  const isOpen = (s: string) => s !== "done";
  const open = tasks.filter((t) => isOpen(t.status));
  const doneP = tasks.filter((t) => t.status === "done" && t.done_on && t.done_on >= per.start && t.done_on <= per.end);
  const spans = doneP.map((t) => Math.max(1, diff(t.done_on!, t.start_on && t.start_on <= t.done_on! ? t.start_on : t.made_on <= t.done_on! ? t.made_on : t.done_on!) + 1)).sort((a, b) => a - b);
  const median = spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : Math.round((spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2)) : null;
  // 평일 수 — 기간 시작부터 오늘(기간이 끝났으면 끝)까지
  const until = per.end < today ? per.end : today;
  let workDays = 0;
  for (let d = per.start; d <= until; d = addDays(d, 1)) if (dow(d) !== 0 && dow(d) !== 6) workDays++;
  const logSet = new Set(logDays.map((l) => l.d));
  // 주별 완료 — 기간 안의 월요일부터
  const mon0 = addDays(per.start, dow(per.start) === 0 ? -6 : 1 - dow(per.start));
  const weeks: PersonCard["weeks"] = [];
  for (let w = mon0; w <= per.end; w = addDays(w, 7)) {
    const we = addDays(w, 6);
    weeks.push({ label: `${Number(w.slice(5, 7))}.${Number(w.slice(8, 10))}`, start: w, n: doneP.filter((t) => t.done_on! >= w && t.done_on! <= we).length });
  }

  return {
    person: p, period: { kind, ...per }, today,
    now: {
      open: open.length, over: open.filter((t) => t.due && t.due < today).length,
      doing: open.filter((t) => t.status === "doing").length, review: open.filter((t) => t.status === "review").length,
      hold: open.filter((t) => t.status === "hold").length, with: withN[0]?.n ?? 0,
    },
    kpi: {
      done: doneP.length, onTime: doneP.filter((t) => t.due && t.done_on! <= t.due).length,
      late: doneP.filter((t) => t.due && t.done_on! > t.due).length, noDue: doneP.filter((t) => !t.due).length,
      cycleMedian: median, goalDone: doneP.filter((t) => t.goals > 0).length,
      logDays: Array.from(logSet).filter((d) => dow(d) !== 0 && dow(d) !== 6).length, workDays,
      lastLog: logs[0]?.logged_on ?? null,
    },
    weeks,
    open: open.map((t) => ({ id: t.id, title: t.title, status: t.status, due: t.due, area: t.area, over: !!t.due && t.due < today }))
      .sort((a, b) => Number(b.over) - Number(a.over) || (a.due ?? "9999").localeCompare(b.due ?? "9999")),
    done: doneP.map((t) => ({ id: t.id, title: t.title, doneOn: t.done_on!, due: t.due, area: t.area, late: !!t.due && t.done_on! > t.due }))
      .sort((a, b) => b.doneOn.localeCompare(a.doneOn)),
    logs: logs.map((l) => ({ id: l.id, loggedOn: l.logged_on, body: l.body, cat: l.cat, taskId: l.task_id })),
    activity: act,
    monthly: monthly.map((m) => ({ month: m.month, status: m.status, submittedAt: m.submitted_at, readAt: m.lead_read_at, comment: m.lead_comment })),
  };
}
