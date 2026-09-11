// v3 「업무」 — 묶고 · 거르고 · 세는 규칙 (MD-P-2026-044 §B). 순수 함수다.
//
// 화면 안에 두지 않는 이유는 「오늘」과 같다: 검사기가 같은 함수를 못 부르면
// 「화면이 자기가 그린 것을 그렸다」밖에 확인 못 한다.
import { daysLate, weekEnd, STALE_DAYS, type TodayTask } from "./today";
import type { AreaView } from "./category";

/** 목록이 쓰는 칸. `/api/tasks` 가 주는 것 중 이만큼만. */
export type TaskRow = TodayTask;

/**
 * 상태 묶음 넷. **순서가 화면 순서다.**
 *
 * 「아직 시작 안 함」이 맨 아래인 이유: 손이 가 있는 것부터 위에 둔다.
 * 완료는 그 아래 — 끝난 것은 참고지 할 일이 아니다.
 */
export const GROUPS = [
  { key: "doing", label: "진행 중", statuses: ["doing"] },
  { key: "review", label: "검토 중", statuses: ["review"] },
  { key: "todo", label: "아직 시작 안 함", statuses: ["todo"] },
  { key: "done", label: "완료", statuses: ["done"] },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];

export type SortKey = "due" | "recent";

/**
 * 기한 표시의 **결**. 「오늘 화면과 같은 기준」이다 (044 §B).
 *
 *   late   지남 7일 이내 → 코랄
 *   stale  지남 7일 초과 → **회색으로 눕힌다**. 여기서도 코랄로 칠하면
 *          목록 절반이 빨개지고, 그러면 급한 것이 안 보인다
 *   soon   오늘 마감
 *   none   기한 없음
 *   plain  그 밖
 *
 * 「업무」 목록은 **접지 않는다** — 전부 보는 자리다. 접는 것은 「오늘」뿐이다.
 */
export type DueTone = "late" | "stale" | "soon" | "none" | "plain";

export function dueTone(due: string | null, today: string): DueTone {
  if (!due) return "none";
  const late = daysLate(due, today);
  if (late > STALE_DAYS) return "stale";
  if (late > 0) return "late";
  if (late === 0) return "soon";
  return "plain";
}

/** 카테고리별 건수. **거르기 전 전체**로 센다 — 칩 숫자는 늘 같아야 한다. */
export function countByArea(tasks: TaskRow[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of tasks) {
    if (t.areaId === null) continue;
    m.set(t.areaId, (m.get(t.areaId) ?? 0) + 1);
  }
  return m;
}

/**
 * 칩 숫자의 합이 전체와 맞는가 — **맞지 않으면 어딘가 새고 있다.**
 *
 * `areaId` 가 없는 업무는 어느 칩에도 안 들어간다. `task.area_id` 는 NOT NULL
 * 이라 지금은 0이어야 하지만, **0이라고 믿지 않고 세어서 낸다.**
 */
export function areaLeak(tasks: TaskRow[], areas: AreaView[]): {
  total: number; counted: number; noArea: number; unknownArea: number;
} {
  const known = new Set(areas.map((a) => a.id));
  let noArea = 0, unknownArea = 0;
  for (const t of tasks) {
    if (t.areaId === null) noArea += 1;
    else if (!known.has(t.areaId)) unknownArea += 1;
  }
  return { total: tasks.length, counted: tasks.length - noArea, noArea, unknownArea };
}

/** 고른 카테고리로 거른다. 빈 집합이면 전체다. */
export function filterByArea(tasks: TaskRow[], picked: Set<number>): TaskRow[] {
  return picked.size === 0 ? tasks : tasks.filter((t) => t.areaId !== null && picked.has(t.areaId));
}

/**
 * 정렬. 기본은 기한 오름차순, **기한 없음은 맨 뒤**.
 *
 * 기한 없음을 0 이나 큰 수로 접으면 다른 것들 사이에 끼어 버리고, 그러면
 * 아무 날에도 안 걸려서 마지막까지 안 보인다 — 037 에서 세운 판단 그대로다.
 */
export function sortTasks(tasks: TaskRow[], by: SortKey): TaskRow[] {
  const rows = tasks.slice();
  if (by === "recent") {
    return rows.sort((a, b) => b.id - a.id);
  }
  return rows.sort((a, b) => {
    if (a.dueDate === null && b.dueDate === null) return a.id - b.id;
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate.localeCompare(b.dueDate) || a.id - b.id;
  });
}

export interface Group { key: GroupKey; label: string; rows: TaskRow[] }

/**
 * 상태로 묶는다. **빈 묶음은 안 그린다** — 없는 것을 자리로 남기지 않는다.
 *
 * 다만 「없어서 안 보이는 것」과 「원래 없는 것」은 다르다. 화면의 「묶기: 상태」
 * 를 열면 **네 상태가 전부 건수와 함께** 나온다(0건 포함) — 그건 `allGroups`.
 */
export function groupTasks(tasks: TaskRow[], by: SortKey): Group[] {
  return allGroups(tasks, by).filter((g) => g.rows.length > 0);
}

/** 넷을 **전부** 낸다 — 0건도 그대로. 「묶기」 안내가 이걸 쓴다 (045 §A). */
export function allGroups(tasks: TaskRow[], by: SortKey): Group[] {
  return GROUPS.map((g) => ({
    key: g.key, label: g.label,
    rows: sortTasks(tasks.filter((t) => (g.statuses as readonly string[]).includes(t.status)), by),
  }));
}

/* ══ 거르개 — 축 넷 + 검색 (MD-P-2026-051 §B) ═══════════════════════
 *
 * **축을 더 만들지 않는다.** 우선순위·프로젝트·생성일은 없다. 거르개가 늘면
 * 「무엇이 걸려 있는지」를 사람이 못 세고, 못 세면 빈 목록이 고장으로 읽힌다.
 *
 * ── 축끼리 섞지 않는다 ──────────────────────────────────────────
 *
 * 기한 축은 **날짜만** 본다. 「지남」에서 완료를 빼고 싶은 마음이 들지만,
 * 그러면 상태 축과 기한 축이 얽혀서 「상태=완료 · 기한=지남」이 영원히 0건이
 * 되고 왜 그런지가 화면 어디에도 안 보인다. 축은 각자 제 것만 보고,
 * 합치는 방식은 **교집합** 하나다.
 */
export type DueKey = "all" | "late" | "soon" | "none";

export const DUE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "late", label: "지남" },
  { key: "soon", label: "오늘·이번 주" },
  { key: "none", label: "기한 없음" },
] as const;

export const DUE_LABEL: Record<DueKey, string> =
  Object.fromEntries(DUE_FILTERS.map((d) => [d.key, d.label])) as Record<DueKey, string>;

export function isDueKey(v: string | null | undefined): v is DueKey {
  return v === "all" || v === "late" || v === "soon" || v === "none";
}

/**
 * 기한 축의 값. 네 갈래에 **달 하나**가 더 있다 — `m:2026-09` (052 §B).
 *
 * ── 왜 축을 안 늘리고 값을 늘렸나 ──────────────────────────────
 *
 * 집계 화면의 칸을 누르면 그 조건의 목록으로 가야 하는데, 집계는 「이 달」로
 * 세고 목록에는 달을 담을 자리가 없었다. 그대로 두면 **칸의 숫자와 열린 목록이
 * 서로 다른 것을 센다** — 조용히 어긋나는 자리다.
 *
 * 그래서 **같은 축(기한)에 값 하나를 더했다.** 축을 더 만들지 않는다(051 §B).
 * 「이 달에 기한인 것」은 기한에 대한 조건이지 새 축이 아니다.
 */
export type DueSel = DueKey | string;   // `m:YYYY-MM`

const DUE_MONTH = /^m:(\d{4})-(0[1-9]|1[0-2])$/;

export function isDueSel(v: string | null | undefined): boolean {
  return isDueKey(v) || (typeof v === "string" && DUE_MONTH.test(v));
}

/** `m:2026-09` → `2026-09`. 달이 아니면 `null`. */
export function dueMonth(sel: DueSel): string | null {
  const m = typeof sel === "string" ? DUE_MONTH.exec(sel) : null;
  return m ? `${m[1]}-${m[2]}` : null;
}

export function dueSelLabel(sel: DueSel): string {
  const ym = dueMonth(sel);
  if (ym) {
    const [y, mm] = ym.split("-");
    return `${Number(y)}년 ${Number(mm)}월`;
  }
  return DUE_LABEL[sel as DueKey] ?? String(sel);
}

/** 걸린 조건 한 벌. **전부 주소에 담긴다** — 새로 열어도 같은 화면이어야 한다. */
export interface Query {
  /** 카테고리 `area.id` */
  cat: Set<number>;
  /** 담당자 `actor.id` */
  who: Set<number>;
  /** 상태 — `GROUPS` 의 대표 상태값 */
  status: Set<string>;
  due: DueSel;
  /** 제목에서 찾는 말 */
  q: string;
}

export const EMPTY_QUERY: Query = {
  cat: new Set(), who: new Set(), status: new Set(), due: "all", q: "",
};

/** 아무것도 안 걸렸는가. 「조건 지우기」를 낼지 말지가 여기서 갈린다. */
export function isEmptyQuery(q: Query): boolean {
  return q.cat.size === 0 && q.who.size === 0 && q.status.size === 0
    && q.due === "all" && q.q.trim() === "";
}

/** 제목에서 찾는다. 대소문자를 안 가린다 — 찾는 사람이 맞춰 칠 이유가 없다. */
export function matchesText(t: TaskRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return needle === "" || t.title.toLowerCase().includes(needle);
}

export function matchesDue(t: TaskRow, due: DueSel, today: string): boolean {
  const ym = dueMonth(due);
  // 달로 고른 경우 — **기한이 그 달인 것.** 기한 없음은 어느 달에도 안 든다(037).
  if (ym !== null) return t.dueDate !== null && t.dueDate.slice(0, 7) === ym;
  if (due === "all") return true;
  if (due === "none") return t.dueDate === null;
  if (t.dueDate === null) return false;
  if (due === "late") return t.dueDate < today;
  return t.dueDate >= today && t.dueDate <= weekEnd(today);   // soon
}

/**
 * 다섯을 **교집합**으로 건다. 합집합이 아니다 —
 * 「담당 A」와 「상태 완료」를 함께 걸면 A 의 완료만 남는다.
 */
export function applyFilters(tasks: TaskRow[], q: Query, today: string): TaskRow[] {
  return tasks.filter((t) =>
    (q.cat.size === 0 || (t.areaId !== null && q.cat.has(t.areaId)))
    && (q.who.size === 0 || (t.assigneeId !== null && q.who.has(t.assigneeId)))
    && (q.status.size === 0 || q.status.has(t.status))
    && matchesDue(t, q.due, today)
    && matchesText(t, q.q));
}

/** 화면 위에 나열할 조건 칩 하나. `axis` 와 `value` 로 **그것만** 풀 수 있다. */
export interface ChipView {
  axis: "cat" | "who" | "status" | "due" | "q";
  /** 축 안에서 지울 값. 축 전체를 지우는 칩(기한·검색)은 `null`. */
  value: number | string | null;
  label: string;
}

/**
 * 걸린 조건을 **사람이 읽는 말로** 나열한다.
 *
 * 이름을 여기서 푸는 이유: 화면이 id 를 그리면 「담당 7」이 뜬다. 모르는
 * id 는 조용히 빼지 않고 **번호 그대로** 적는다 — 지운 구성원으로 걸린
 * 조건이 안 보이면 결과가 왜 비었는지 알 수가 없다.
 */
export function activeChips(
  q: Query,
  areas: { id: number; name: string }[],
  people: { id: number; name: string }[],
): ChipView[] {
  const out: ChipView[] = [];
  const nameOf = (list: { id: number; name: string }[], id: number) =>
    list.find((x) => x.id === id)?.name ?? `#${id}`;
  for (const id of Array.from(q.cat).sort((a, b) => a - b)) {
    out.push({ axis: "cat", value: id, label: `카테고리 · ${nameOf(areas, id)}` });
  }
  for (const id of Array.from(q.who).sort((a, b) => a - b)) {
    out.push({ axis: "who", value: id, label: `담당 · ${nameOf(people, id)}` });
  }
  for (const g of GROUPS) {
    if (q.status.has(g.statuses[0])) {
      out.push({ axis: "status", value: g.statuses[0], label: `상태 · ${g.label}` });
    }
  }
  if (q.due !== "all") out.push({ axis: "due", value: null, label: `기한 · ${dueSelLabel(q.due)}` });
  if (q.q.trim() !== "") out.push({ axis: "q", value: null, label: `검색 · ${q.q.trim()}` });
  return out;
}
