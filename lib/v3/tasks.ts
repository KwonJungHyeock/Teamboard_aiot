// v3 「업무」 — 묶고 · 거르고 · 세는 규칙 (MD-P-2026-044 §B). 순수 함수다.
//
// 화면 안에 두지 않는 이유는 「오늘」과 같다: 검사기가 같은 함수를 못 부르면
// 「화면이 자기가 그린 것을 그렸다」밖에 확인 못 한다.
import { daysLate, STALE_DAYS, type TodayTask } from "./today";
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
