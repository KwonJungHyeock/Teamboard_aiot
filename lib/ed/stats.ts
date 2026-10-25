// 성과 분석 (DESIGN.md 5.8) — 숫자는 전부 서버가 센다. 화면은 받아서 그리기만 한다.
//
// 대상: 집계 대상 업무(countableSql) 중 **상위 업무만**(체크리스트 = 하위 업무는 빼고), 보는 사람에게 보이는 것.
// 날짜는 전부 KST.
//   · 완료율 고리   기한이 그 해 / 분기 / 달에 든 업무 중 완료 비율
//   · 주간 완료     기준일이 든 주까지 8주, 주마다 완료한 건수
//   · 처리 기간     그 달에 완료한 업무 — 시작일(없으면 만든 날) → 완료일 일수
//   · 지연 노후도   기준일에 기한이 지난 미완 업무 — 지난 일수 구간
//   · 가오픈 추이   이 달 1일 ~ 가오픈 사이, 가오픈까지 기한인 업무의 잔여(실제) · 계획(직선) · 지금 속도 예상
//   · 이 달 기한    기한이 그 달인 업무 — 상태별(교차표와 같은 모집단)
//   · 담당자 부하   지금 미완 업무 — 지남 · 진행 · 검토 · 시작 전
// 기준일: 고른 달이 이번 달이면 오늘, 지난 달이면 그 달 말일, 앞 달이면 그 달 1일.
import { query } from "../db";
import { countableSql } from "../progress";
import { visibleTaskSql } from "../visibility";
import { getPlatformOpen } from "../platform-config";

export type St4 = "doing" | "review" | "todo" | "done";
export const ST4: St4[] = ["doing", "review", "todo", "done"];

export interface StatsData {
  month: string; today: string; ref: string; live: boolean;
  rings: { label: string; done: number; total: number }[];
  weeks: { label: string; n: number }[];
  cycle: { avg: number | null; median: number | null; buckets: number[] };
  aging: { buckets: number[]; max: number };
  burn: {
    start: string; open: string; days: number; todayIdx: number; scope: number;
    remaining: number[]; rate: number; need: number; projected: number; past: boolean;
  };
  monthDue: Record<St4, number>;
  launch: { before: number; after: number; none: number; done: number };
  cross: { cat: { id: number; label: string; v: number[] }[]; who: { id: number; label: string; v: number[] }[] };
  load: { name: string; v: number[] }[];
}

interface Row {
  id: number; status: string; due: string | null; done_on: string | null; made_on: string; start_on: string | null;
  area: string; who: string | null; assignee_id: number | null;
}

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;
const isoWeek = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - y0.getTime()) / 86400000 - 3 + ((y0.getUTCDay() + 6) % 7)) / 7);
};
const monday = (iso: string) => { const w = new Date(`${iso}T00:00:00Z`).getUTCDay(); return addDays(iso, w === 0 ? -6 : 1 - w); };
const norm = (s: string): St4 => (s === "doing" || s === "review" || s === "done" ? s : "todo");

export async function getStats(viewerId: number, month: string, today: string): Promise<StatsData> {
  const [rows, people, areas, { openAt }] = await Promise.all([
    query<Row>(
      `SELECT t.id, t.status, t.due_date::text AS due,
              ((t.completed_at AT TIME ZONE 'Asia/Seoul')::date)::text AS done_on,
              ((t.created_at AT TIME ZONE 'Asia/Seoul')::date)::text AS made_on,
              t.start_date::text AS start_on, ar.name AS area, a.display_name AS who, t.assignee_id
         FROM task t JOIN area ar ON ar.id = t.area_id LEFT JOIN actor a ON a.id = t.assignee_id
        WHERE ${countableSql("t")} AND t.parent_task_id IS NULL AND ${visibleTaskSql("$1")}`, [viewerId]),
    query<{ id: number; name: string }>(`SELECT id, display_name AS name FROM actor WHERE type = 'human' AND is_active ORDER BY id`),
    query<{ id: number; name: string }>(`SELECT id, name FROM area WHERE is_active ORDER BY sort_order, id`),
    getPlatformOpen(),
  ]);
  const curMonth = today.slice(0, 7);
  const live = month === curMonth;
  const mStart = `${month}-01`, mEnd = monthEnd(month);
  const ref = live ? today : month < curMonth ? mEnd : mStart;
  const isDone = (r: Row) => r.status === "done";
  const doneBy = (r: Row, d: string) => isDone(r) && !!r.done_on && r.done_on <= d;

  // ── 완료율 고리 ─────────────────────────────────────────
  const y = month.slice(0, 4), mi = Number(month.slice(5, 7)), q = Math.ceil(mi / 3);
  const qStart = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`, qEnd = monthEnd(`${y}-${String(q * 3).padStart(2, "0")}`);
  const ring = (a: string, b: string) => { const xs = rows.filter((r) => r.due && r.due >= a && r.due <= b); return { done: xs.filter(isDone).length, total: xs.length }; };
  const rings = [
    { label: y, ...ring(`${y}-01-01`, `${y}-12-31`) },
    { label: `Q${q}`, ...ring(qStart, qEnd) },
    { label: `${mi}월`, ...ring(mStart, mEnd) },
  ];

  // ── 주간 완료 8주 ───────────────────────────────────────
  const wk0 = monday(ref);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const a = addDays(wk0, (i - 7) * 7), b = addDays(a, 6);
    return { label: i === 7 && live ? "이번" : `W${isoWeek(a)}`, n: rows.filter((r) => isDone(r) && r.done_on && r.done_on >= a && r.done_on <= b).length };
  });

  // ── 처리 기간 ───────────────────────────────────────────
  const spans = rows.filter((r) => isDone(r) && r.done_on && r.done_on >= mStart && r.done_on <= mEnd)
    .map((r) => Math.max(1, diff(r.done_on!, r.start_on && r.start_on <= r.done_on! ? r.start_on : r.made_on <= r.done_on! ? r.made_on : r.done_on!) + 1))
    .sort((a, b) => a - b);
  const cycle = {
    avg: spans.length ? +(spans.reduce((s, x) => s + x, 0) / spans.length).toFixed(1) : null,
    median: spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : Math.round((spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2)) : null,
    buckets: [spans.filter((x) => x <= 1).length, spans.filter((x) => x >= 2 && x <= 3).length, spans.filter((x) => x >= 4 && x <= 7).length,
      spans.filter((x) => x >= 8 && x <= 14).length, spans.filter((x) => x >= 15).length],
  };

  // ── 지연 노후도 ─────────────────────────────────────────
  const late = rows.filter((r) => r.due && r.due < ref && !doneBy(r, ref) && r.made_on <= ref).map((r) => diff(ref, r.due!));
  const aging = {
    buckets: [late.filter((x) => x <= 3).length, late.filter((x) => x >= 4 && x <= 7).length, late.filter((x) => x >= 8 && x <= 14).length, late.filter((x) => x >= 15).length],
    max: late.length ? Math.max(...late) : 0,
  };

  // ── 가오픈 잔여 추이 ────────────────────────────────────
  const open = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(openAt));
  const past = today > open;
  const anchor = past ? addDays(open, -1) : today;
  const start = `${anchor.slice(0, 7)}-01`;
  const days = Math.max(1, diff(open, start));
  const todayIdx = Math.min(days, Math.max(0, diff(today, start)));
  const scopeRows = rows.filter((r) => r.due && r.due <= open && !(isDone(r) && r.done_on && r.done_on < start));
  const scope = scopeRows.length;
  const remaining = Array.from({ length: todayIdx + 1 }, (_, d) => scope - scopeRows.filter((r) => doneBy(r, addDays(start, d))).length);
  const doneInWin = scope - remaining[todayIdx];
  const rate = todayIdx > 0 ? doneInWin / todayIdx : 0;
  const left = days - todayIdx;
  const burn = {
    start, open, days, todayIdx, scope, remaining, past,
    rate: +rate.toFixed(2), need: left > 0 ? +(remaining[todayIdx] / left).toFixed(2) : 0,
    projected: Math.max(0, Math.round(remaining[todayIdx] - rate * left)),
  };

  // ── 이 달 기한 · 교차표 ─────────────────────────────────
  const monthRows = rows.filter((r) => r.due && r.due >= mStart && r.due <= mEnd);
  const vec = (xs: Row[]) => ST4.map((s) => xs.filter((r) => norm(r.status) === s).length);
  const monthDue = Object.fromEntries(ST4.map((s, i) => [s, vec(monthRows)[i]])) as Record<St4, number>;
  const cross = {
    cat: areas.map((a) => ({ id: a.id, label: a.name, v: vec(monthRows.filter((r) => r.area === a.name)) })),
    who: people.map((p) => ({ id: p.id, label: p.name, v: vec(monthRows.filter((r) => r.assignee_id === p.id)) })),
  };

  // ── 가오픈 기준 구분 · 담당자 부하(지금) ────────────────
  const openNow = rows.filter((r) => !isDone(r));
  const launch = {
    before: openNow.filter((r) => r.due && r.due <= open).length,
    after: openNow.filter((r) => r.due && r.due > open).length,
    none: openNow.filter((r) => !r.due).length,
    done: rows.filter(isDone).length,
  };
  const load = people.map((p) => {
    const xs = openNow.filter((r) => r.assignee_id === p.id);
    const over = xs.filter((r) => r.due && r.due < today);
    const rest = xs.filter((r) => !(r.due && r.due < today));
    return { name: p.name, v: [over.length, rest.filter((r) => r.status === "doing").length, rest.filter((r) => r.status === "review").length, rest.filter((r) => norm(r.status) === "todo").length] };
  }).sort((a, b) => b.v.reduce((s, x) => s + x, 0) - a.v.reduce((s, x) => s + x, 0));

  return { month, today, ref, live, rings, weeks, cycle, aging, burn, monthDue, launch, cross, load };
}

/** AI 에게 보내는 것 — 숫자만. 업무 제목 · 사람 이름은 보내지 않는다 */
export function statsFacts(s: StatsData) {
  const loads = s.load.map((l) => ({ over: l.v[0], total: l.v.reduce((a, b) => a + b, 0) })).filter((l) => l.total > 0);
  const overAll = loads.reduce((a, l) => a + l.over, 0);
  const topOver = loads.reduce((m, l) => Math.max(m, l.over), 0);
  const b = s.burn;
  const third = Math.max(1, Math.floor(b.todayIdx / 3));
  const doneIn = (a: number, z: number) => (b.remaining[a] ?? b.scope) - (b.remaining[z] ?? b.scope);
  return {
    가오픈까지_남은_일수: b.days - b.todayIdx, 가오픈_대상_업무: b.scope, 남은_업무: b.remaining[b.todayIdx],
    하루_완료_속도: b.rate, 필요_속도: b.need, 지금_속도면_가오픈때_남음: b.projected,
    구간별_완료: { 앞: doneIn(0, third), 가운데: doneIn(third, third * 2), 최근: doneIn(third * 2, b.todayIdx) },
    계획_대비_차이: Math.round(b.remaining[b.todayIdx] - b.scope * (1 - b.todayIdx / b.days)),
    주간_완료_8주: s.weeks.map((w) => w.n), 지연_업무: overAll, 지연_최다_한사람_건수: topOver, 지연_최장_일수: s.aging.max,
    처리기간_평균일: s.cycle.avg, 이달_기한_상태: s.monthDue, 담당자_수: loads.length, 적정_부하: 8,
    부하_초과_인원: loads.filter((l) => l.total > 8).length,
  };
}
