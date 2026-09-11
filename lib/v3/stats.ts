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
