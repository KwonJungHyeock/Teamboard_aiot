// v3 「팀 현황」 — 사람별 열로 가르는 규칙 (MD-P-2026-052 §A). 순수 함수다.
//
// ── 이름을 코드에 안 박는다 ─────────────────────────────────────
//
// 열은 **계정에서 온다**(`actor(type='human', is_active)`). 이 파일에 사람
// 이름이 하나도 없는 이유다 — 박아 두면 사람이 바뀔 때 코드를 고쳐야 하고,
// 아무도 그걸 규칙이라고 안 읽는다 (§G · 이름으로 판정하지 않는다).
import { weekEnd, type TodayTask } from "./today";
import { GROUPS, sortTasks, type TaskRow } from "./tasks";

/** 한 열에 세우는 건수. 넘으면 「＋n건 더 보기」로 접는다. */
export const COL_MAX = 5;

/**
 * 여기 서는 상태 — **완료는 안 보인다.**
 *
 * 「지금 이 사람이 들고 있는 것」을 보는 자리다. 끝난 것을 섞으면 열 길이가
 * 일한 양이 아니라 쌓인 양이 되고, 그러면 누가 막혀 있는지가 안 보인다.
 * 중단·제안도 빠진다 — 손에 들고 있는 것이 아니다.
 */
export const OPEN_STATUSES = GROUPS
  .filter((g) => g.key !== "done")
  .map((g) => g.statuses[0] as string);

export function isOpen(status: string): boolean {
  return OPEN_STATUSES.includes(status);
}

export interface Person {
  id: number;
  name: string;
  role: string;
  adminGrant: boolean;
}

export interface Column {
  /** 사람 번호. **「담당 없음」 열은 `null`.** */
  id: number | null;
  name: string;
  role: string | null;
  adminGrant: boolean;
  rows: TaskRow[];
  /** 기한이 지난 것 */
  late: number;
  /** 오늘부터 이번 주 일요일까지 */
  week: number;
  total: number;
  /**
   * 「담당 없음」 열에 **비활성 계정 담당**이 몇 건 섞여 있는가.
   * 0이면 안 적는다 — 없는 사실을 줄로 남기지 않는다.
   */
  inactive: number;
}

/**
 * 열을 만든다. **활성 담당자 수만큼** + 필요할 때 「담당 없음」 하나.
 *
 * ── 사라지는 사람이 없어야 한다 ────────────────────────────────
 *
 * 비활성 계정은 열을 안 그린다(지시 §A). 그런데 그 사람 앞으로 진행 중 업무가
 * 남아 있으면 **그 업무가 어느 열에도 안 들어가서 조용히 사라진다.**
 * 그래서 「담당 없음」 열로 모으고, 몇 건이 비활성 담당인지 따로 센다.
 * 담당이 아예 없는 업무(`assigneeId === null`)도 같은 열이다.
 */
export function buildColumns(
  tasks: TaskRow[], people: Person[], today: string,
): Column[] {
  const open = tasks.filter((t) => isOpen(t.status));
  const active = new Set(people.map((p) => p.id));
  const end = weekEnd(today);

  const stat = (rows: TaskRow[]) => ({
    late: rows.filter((t) => t.dueDate !== null && t.dueDate < today).length,
    week: rows.filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= end).length,
    total: rows.length,
  });

  const cols: Column[] = people.map((p) => {
    const rows = sortTasks(open.filter((t) => t.assigneeId === p.id), "due");
    return {
      id: p.id, name: p.name, role: p.role, adminGrant: p.adminGrant,
      rows, ...stat(rows), inactive: 0,
    };
  });

  const orphan = open.filter((t) => t.assigneeId === null || !active.has(t.assigneeId));
  if (orphan.length > 0) {
    const rows = sortTasks(orphan, "due");
    cols.push({
      id: null, name: "담당 없음", role: null, adminGrant: false,
      rows, ...stat(rows),
      // 담당이 **있는데 비활성**인 것. 「담당 없음」과 뜻이 달라서 따로 센다.
      inactive: orphan.filter((t) => t.assigneeId !== null).length,
    });
  }
  return cols;
}

/**
 * 열 수에 따른 배치. **미리 정해 둔다** (지시 §A).
 *
 *   셋까지   그대로 3열
 *   넷       4열로 좁힌다
 *   다섯 이상 가로로 민다 — 열 너비를 지키고 화면이 넘친다
 *
 * **접거나 숨기지 않는다.** 좁히다가 접으면 안 보이는 사람이 생기고,
 * 안 보이는 사람의 일은 없는 일이 된다.
 */
export function columnLayout(n: number): { cols: number; scroll: boolean; min: number } {
  if (n <= 3) return { cols: Math.max(n, 1), scroll: false, min: 0 };
  if (n === 4) return { cols: 4, scroll: false, min: 0 };
  return { cols: n, scroll: true, min: 260 };
}

/** 열 머리의 한 줄. 0이면 그 조각을 안 적는다 — 「지남 0」은 눈만 붙든다. */
export function headLine(c: Column): string {
  const bits: string[] = [];
  if (c.late > 0) bits.push(`지남 ${c.late}`);
  if (c.week > 0) bits.push(`이번 주 ${c.week}`);
  return bits.length > 0 ? bits.join(" · ") : "지남·이번 주 없음";
}

/** 다섯까지 세우고 나머지는 접는다. **몇 건이 접혔는지는 보인다.** */
export function foldRows(rows: TaskRow[], max = COL_MAX): { shown: TaskRow[]; more: number } {
  if (rows.length <= max) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, max), more: rows.length - max };
}

/**
 * 열 건수의 합. **진행 중 전체와 같아야 한다** — 다르면 어딘가 새고 있다.
 * 화면이 이 값을 스스로 맞춰 보이게 하려고 여기서 함께 낸다.
 */
export function columnTally(cols: Column[], tasks: TaskRow[]): {
  sum: number; open: number; ok: boolean;
} {
  const sum = cols.reduce((n, c) => n + c.total, 0);
  const open = tasks.filter((t) => isOpen(t.status)).length;
  return { sum, open, ok: sum === open };
}

export type { TodayTask };
