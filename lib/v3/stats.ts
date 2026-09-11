// v3 「집계」 — 표 두 장을 세는 규칙 (MD-P-2026-052 §B). 순수 함수다.
//
// ── 다시 세지 않는다 ────────────────────────────────────────────
//
// 기한 세 갈래는 `/api/tasks/open-due` 것을 **그대로 인용한다.** 여기서 또 세면
// 언젠가 갈라지고, 갈라지면 어느 쪽이 맞는지 아무도 모른다(046 에서 겪었다).
//
// ── 합이 맞는지 화면에서 보인다 ─────────────────────────────────
//
// 행 합계의 합 · 열 합계의 합 · 전체가 **같은 수여야 한다.** 안 맞으면 어딘가
// 새고 있는 것이고, 안 맞는 총합은 사람을 다시 세게 만든다.
// 그래서 `reconcile()` 이 셋을 함께 내고, 화면은 그 식을 그대로 적는다.
import { GROUPS, type TaskRow } from "./tasks";

/** 표의 열 — 상태 넷. **목록·상세와 같은 이름**을 쓴다. */
export const STAT_COLUMNS = GROUPS.map((g) => ({
  key: g.key as string,
  label: g.label,
  status: g.statuses[0] as string,
}));

/** 한 줄이 가리키는 것. `id` 가 `null` 이면 「없음」 줄이다. */
export interface StatRow {
  id: number | null;
  label: string;
  /** 상태별 건수. `STAT_COLUMNS` 와 같은 차례. */
  cells: number[];
  total: number;
}

export interface StatTable {
  rows: StatRow[];
  /** 열별 합계 */
  colTotals: number[];
  /** 전체 */
  total: number;
}

/** `2026-09` 의 첫날·끝날. 달 이동과 표의 기간이 같은 곳에서 나온다. */
export function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}

/** 기한이 그 달인 업무만. **기한 없음은 어느 달에도 안 든다**(037). */
export function inMonth(t: TaskRow, ym: string): boolean {
  return t.dueDate !== null && t.dueDate.slice(0, 7) === ym;
}

/**
 * 표 한 장. `keyOf` 가 줄을 가른다 — 카테고리면 `areaId`, 담당자면 `assigneeId`.
 *
 * **줄이 0건이어도 그린다.** 없는 카테고리를 조용히 빼면 일곱 개가 다 있는지
 * 세어 볼 수가 없다(043 부터의 판단). 대신 「없음」 줄은 **0이면 안 그린다** —
 * 없는 사실을 줄로 남기지 않는다.
 */
export function crossTab(
  tasks: TaskRow[],
  keys: { id: number; label: string }[],
  keyOf: (t: TaskRow) => number | null,
  noneLabel: string,
): StatTable {
  const known = new Set(keys.map((k) => k.id));
  const blank = () => STAT_COLUMNS.map(() => 0);
  const bucket = new Map<number | null, number[]>();
  for (const k of keys) bucket.set(k.id, blank());
  bucket.set(null, blank());

  for (const t of tasks) {
    const col = STAT_COLUMNS.findIndex((c) => c.status === t.status);
    if (col === -1) continue;                  // 네 상태 밖(중단 등)은 `outside()` 가 센다
    const raw = keyOf(t);
    const k = raw !== null && known.has(raw) ? raw : null;
    bucket.get(k)![col] += 1;
  }

  const mk = (id: number | null, label: string): StatRow => {
    const cells = bucket.get(id) ?? blank();
    return { id, label, cells, total: cells.reduce((a, b) => a + b, 0) };
  };

  const rows = keys.map((k) => mk(k.id, k.label));
  const none = mk(null, noneLabel);
  if (none.total > 0) rows.push(none);

  const colTotals = STAT_COLUMNS.map((_, i) => rows.reduce((n, r) => n + r.cells[i], 0));
  return { rows, colTotals, total: colTotals.reduce((a, b) => a + b, 0) };
}

/**
 * 네 상태 **밖**에 있는 업무. 지금은 중단(dropped)이다.
 *
 * 조용히 빼면 표의 합이 전체보다 적은데 왜인지가 화면에 안 남는다.
 * 빼되 **몇을 뺐는지 적는다** — 041 의 「완료 제외」와 같은 규칙이다.
 */
export function outside(tasks: TaskRow[]): { n: number; statuses: string[] } {
  const known = new Set(STAT_COLUMNS.map((c) => c.status));
  const out = tasks.filter((t) => !known.has(t.status));
  return { n: out.length, statuses: Array.from(new Set(out.map((t) => t.status))).sort() };
}

/**
 * 합이 맞는가. **행 합 · 열 합 · 전체가 같아야 한다.**
 *
 * 셋을 따로 내는 이유: 하나만 내면 「맞다」밖에 못 말한다. 셋을 나란히 적으면
 * 어긋났을 때 **어느 쪽이 새는지**가 바로 보인다.
 */
export function reconcile(table: StatTable, inPeriod: number, out: number): {
  rowSum: number; colSum: number; total: number; expected: number; ok: boolean;
} {
  const rowSum = table.rows.reduce((n, r) => n + r.total, 0);
  const colSum = table.colTotals.reduce((a, b) => a + b, 0);
  const expected = inPeriod - out;
  return { rowSum, colSum, total: table.total, expected,
    ok: rowSum === colSum && colSum === table.total && table.total === expected };
}

/** 「2026년 9월」. 캘린더와 같은 말을 쓴다 — 화면마다 다르게 부르지 않는다. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}

/** 달 이동. 12월 다음은 이듬해 1월이다. */
export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 칸을 누르면 가는 곳. **051 의 주소 필터를 그대로 쓴다.**
 *
 * 달은 기한 축의 값(`due=m:YYYY-MM`)으로 실린다 — 축을 더 만들지 않는다.
 * 이게 없으면 칸의 숫자와 열린 목록이 서로 다른 것을 센다.
 */
export function cellHref(
  axis: "cat" | "who", id: number | null, status: string | null, ym: string,
): string {
  const p = new URLSearchParams();
  if (id !== null) p.set(axis, String(id));
  if (status !== null) p.set("st", status);
  p.set("due", `m:${ym}`);
  return `/v3/tasks?${p}`;
}

/* ══ 056 §B 원그래프 ═══════════════════════════════════════════════
 *
 * 목업 파일 `미션덱-v5-집계원그래프-목업.html` 은 **리포에 없다.** 042 때와 같아서
 * 지시서에 적힌 값(색·문구·배치)을 그대로 옮겼다. 문서 규칙 §1 대로 보고한다.
 *
 * ── 셋이 같은 함수에서 나온다 ───────────────────────────────────
 *
 * 연간·분기·월이 각자 세면 합이 안 맞는다. 기간만 다른 **같은 셈**이므로
 * `ringOf()` 하나를 세 번 부른다.
 */

/** 고리 하나가 보는 기간. 화면이 이 셋을 나란히 그린다. */
export interface Range {
  key: "year" | "quarter" | "month";
  label: string;
  start: string;
  end: string;
}

/** 그 달이 속한 분기. 1–3월이 Q1 이다. */
function quarterOf(ym: string): { q: number; start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  const s = (q - 1) * 3 + 1;
  const e = s + 2;
  const last = new Date(Date.UTC(y, e, 0)).getUTCDate();
  return {
    q,
    start: `${y}-${String(s).padStart(2, "0")}-01`,
    end: `${y}-${String(e).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

/**
 * 보고 있는 달에서 기간 셋을 낸다.
 *
 * **달을 옮기면 셋이 다 따라간다** — 헤더의 ◀ 이번 달 ▶ 하나가 셋을 움직인다.
 * 연간·분기를 따로 고르게 하면 셋이 서로 다른 때를 가리킬 수 있고, 그러면
 * 나란히 놓은 뜻이 없어진다.
 */
export function rangesFor(ym: string): Range[] {
  const [y] = ym.split("-").map(Number);
  const q = quarterOf(ym);
  const mb = monthBounds(ym);
  return [
    { key: "year", label: `${y}년`, start: `${y}-01-01`, end: `${y}-12-31` },
    { key: "quarter", label: `${y} Q${q.q}`, start: q.start, end: q.end },
    { key: "month", label: monthLabel(ym), start: mb.start, end: mb.end },
  ];
}

/** 기한이 그 기간 안에 있는가. **기한 없음은 어느 기간에도 안 든다**(037). */
export function inRange(t: TaskRow, r: Range): boolean {
  return t.dueDate !== null && t.dueDate >= r.start && t.dueDate <= r.end;
}

/** 오늘부터 기간 끝까지 **며칠 남았는가**. 이미 지났으면 0 — 「-12일 남음」은 말이 안 된다. */
export function daysLeft(today: string, end: string): number {
  const d = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return Math.max(0, d);
}

export interface Ring {
  key: Range["key"];
  label: string;
  done: number;
  total: number;
  /** 0–100 정수. 분모가 0이면 0 — **0으로 나누지 않는다.** */
  pct: number;
  /** 남은 것 = 전체 − 완료 */
  left: number;
  daysLeft: number;
}

/**
 * 고리 하나. **분모가 0이면 0%** 로 둔다.
 *
 * 0/0 을 100% 로 읽는 계산이 흔한데, 그러면 아무 일도 없는 달이 「다 했다」로
 * 보인다. 할 일이 없는 것과 다 한 것은 다르다 — 화면이 「0 / 0건」을 함께 적는다.
 */
export function ringOf(tasks: TaskRow[], r: Range, today: string): Ring {
  const inside = tasks.filter((t) => inRange(t, r));
  const done = inside.filter((t) => t.status === "done").length;
  const total = inside.length;
  return {
    key: r.key, label: r.label, done, total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    left: total - done,
    daysLeft: daysLeft(today, r.end),
  };
}

/**
 * 고리의 획 길이. 반지름만 받고 **비율을 다시 안 센다** — `Ring.pct` 를 쓴다.
 * 화면이 기하를 계산하기 시작하면 숫자와 그림이 갈라진다.
 */
export function ringDash(pct: number, radius: number): { dash: number; circumference: number } {
  const circumference = 2 * Math.PI * radius;
  return { dash: (Math.max(0, Math.min(100, pct)) / 100) * circumference, circumference };
}

/* ── 상태 분포 (B-2) ─────────────────────────────────────────────
 *
 * **색은 지시서 값 그대로다.** 색각 검사를 통과한 조합이라고 적혀 있어서
 * 고르지 않고 옮겼다. 회색 하나는 일부러 무채색이다 — 아직 색이 붙을 일이
 * 없다는 뜻이다.
 *
 * 그리고 **색만으로 구분하지 않는다**: 조각마다 숫자를 직접 적고 사이를 띄운다.
 */
export const DIST_SEGMENTS = [
  { key: "doing", label: "진행 중", status: "doing", color: "#C97A0E", ink: "#16203A" },
  { key: "review", label: "검토 중", status: "review", color: "#2F6FED", ink: "#FFFFFF" },
  { key: "done", label: "완료", status: "done", color: "#2E9E5B", ink: "#16203A" },
  { key: "todo", label: "아직 시작 안 함", status: "todo", color: "#9AA4B8", ink: "#16203A" },
] as const;

/*
 * ── 글자색은 **바탕마다 다르다** ────────────────────────────────
 *
 * 바탕 넷은 지시서 값 그대로다. 그런데 넷에 흰 글자를 얹었더니 회색(#9AA4B8)
 * 위에서 대비가 2.5:1 밖에 안 나왔다 — **숫자가 안 읽히면 「색만으로 구분하지
 * 않는다」가 무너진다.** 숫자를 적어 둔 뜻이 없어진다.
 *
 * 그래서 바탕별로 더 잘 읽히는 쪽을 골랐다(계산값, 흰색 / 진한 글자):
 *   #C97A0E  3.4 / 6.3  → 진한 글자
 *   #2F6FED  4.6 / 4.6  → 흰 글자 (파랑 위는 흰 쪽이 눈에 편하다)
 *   #2E9E5B  3.4 / 4.8  → 진한 글자
 *   #9AA4B8  2.5 / 6.5  → 진한 글자
 * **바탕색은 하나도 안 바꿨다.**
 */

export interface Segment {
  key: string; label: string; color: string;
  /** 그 바탕 위에서 읽히는 글자색. 바탕은 안 바꾸고 글자만 고른다. */
  ink: string;
  n: number;
  /** 0–100. 막대 폭이다. 분모가 0이면 0. */
  pct: number;
}

/**
 * 네 구간. **0건도 낸다** — 그려는 안 그리고 범례에 0으로 적는다.
 * 조용히 빼면 네 상태가 다 있는지 세어 볼 수가 없다(045 부터의 판단).
 */
export function distribution(tasks: TaskRow[], r: Range): { segments: Segment[]; total: number } {
  const inside = tasks.filter((t) => inRange(t, r));
  const total = inside.length;
  const segments = DIST_SEGMENTS.map((s) => {
    const n = inside.filter((t) => t.status === s.status).length;
    return { key: s.key, label: s.label, color: s.color, ink: s.ink, n,
             pct: total === 0 ? 0 : (n / total) * 100 };
  });
  return { segments, total };
}

/**
 * 막대의 합이 기간 전체와 맞는가 (052 §B 그대로).
 * 네 상태 밖(중단 등)은 `outside()` 가 세므로 여기서는 **빠진 수만** 낸다.
 */
export function distTally(segments: Segment[], inPeriod: number, out: number): {
  sum: number; expected: number; ok: boolean;
} {
  const sum = segments.reduce((n, s) => n + s.n, 0);
  return { sum, expected: inPeriod - out, ok: sum === inPeriod - out };
}

/** 호버에 띄우는 말. 「분기 · 완료 31건 / 전체 41건」 */
export function ringHover(r: Ring): string {
  const what = r.key === "year" ? "연간" : r.key === "quarter" ? "분기" : "이번 달";
  return `${what} · 완료 ${r.done}건 / 전체 ${r.total}건`;
}

export function segHover(s: Segment, total: number): string {
  return `${s.label} · ${s.n}건 / 전체 ${total}건`;
}
