// v3 「캘린더」 — 달을 격자로 펴는 규칙 (MD-P-2026-046 §C). 순수 함수다.
//
// 화면 안에 두지 않는 이유는 앞의 셋과 같다: 검사기가 같은 함수를 못 부르면
// 「화면이 자기가 그린 것을 그렸다」밖에 확인 못 한다.
//
// **날짜는 전부 `YYYY-MM-DD` 글자다.** `Date` 를 들고 다니지 않는다 —
// 시간대가 붙는 순간 「9월 1일」이 기계마다 달라진다. 계산이 필요한 자리에서만
// UTC 자정으로 올려 놓고 셈하고, 바로 글자로 내린다(`daysLate` 와 같은 방식).
import type { TaskRow } from "./tasks";

/** 한 칸에 세우는 알약 수. 넘치면 `＋n` 으로 접는다. */
export const CELL_MAX = 3;

const YM = /^(\d{4})-(\d{2})$/;

/** 날짜 글자에서 달(`YYYY-MM`)만. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * 주소에서 읽은 달. 이상하면 **오늘의 달**로 돌아온다.
 *
 * 주소를 손으로 고칠 수 있으므로 `?m=2026-99` 가 온다. 빈 격자를 그리느니
 * 오늘로 돌아온다 — 빈 달력은 고장으로 읽힌다.
 */
export function parseMonth(raw: string | null | undefined, today: string): string {
  const m = raw ? YM.exec(raw) : null;
  if (!m) return monthOf(today);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return monthOf(today);
  return raw as string;
}

/** 달 이동. `by` 는 ±1 이 보통이다. 12월 다음은 이듬해 1월이다. */
export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 「2026년 9월」. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 달 격자. **여섯 줄 고정**이다 — 42칸.
 *
 * 달마다 줄 수가 달라지면(4~6) 달을 넘길 때 화면 높이가 출렁이고, 그러면 아래
 * 있던 것을 누르려다 다른 것을 누른다. 앞뒤 달의 날짜가 몇 칸 섞이지만 그건
 * 흐리게 그리면 된다 — `inMonth()` 가 가른다.
 *
 * 주는 **일요일에 시작**한다.
 */
export function monthGrid(ym: string): string[][] {
  const [y, m] = ym.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  // 그 주의 일요일까지 되감는다.
  const start = first - new Date(first).getUTCDay() * 86400000;
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const row: string[] = [];
    for (let d = 0; d < 7; d += 1) {
      row.push(new Date(start + (w * 7 + d) * 86400000).toISOString().slice(0, 10));
    }
    weeks.push(row);
  }
  return weeks;
}

/** 이 달의 날인가. 앞뒤 달에서 딸려 온 칸은 흐리게 그린다. */
export function inMonth(date: string, ym: string): boolean {
  return monthOf(date) === ym;
}

/**
 * 기한으로 날짜에 붙인다.
 *
 * **기한 없는 업무는 어느 칸에도 안 들어간다.** 0 이나 먼 미래로 접으면 아무
 * 날에나 걸려서 거짓말이 된다 — 대신 화면이 「기한 없음 n건」을 따로 적는다
 * (`noDueCount`). 037 부터 지켜 온 판단이다: 기한 없음은 별개의 갈래다.
 */
export function byDay(tasks: TaskRow[]): Map<string, TaskRow[]> {
  const m = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const k = t.dueDate.slice(0, 10);
    const list = m.get(k);
    if (list) list.push(t); else m.set(k, [t]);
  }
  // 한 칸 안의 차례 — 완료를 아래로, 그다음 번호순. 끝난 것이 위에 서면
  // 세 칸 안에 남은 일이 안 보인다.
  for (const list of Array.from(m.values())) {
    list.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.id - b.id);
  }
  return m;
}

/**
 * 기한이 없어서 달력 어디에도 안 서는 업무. **둘로 나눠서 낸다.**
 *
 * ── 왜 둘인가 ────────────────────────────────────────────────────
 *
 * 화면 위쪽 네 숫자는 `/api/tasks/open-due` 것을 그대로 인용한다. 그 집계는
 * **완료를 세 갈래에서 뺀다.** 그런데 달력이 그리는 재료(`/api/tasks`)에는
 * 완료가 들어 있다. 그래서 한 화면에 「기한 없는 3건」과 「기한 없음 2」가
 * 나란히 떴다 — 같은 말인데 숫자가 다르면 읽는 사람은 고장으로 읽는다.
 *
 * 둘 다 맞는 숫자다. 세는 대상이 다를 뿐이다. 그러니 **차이를 감추지 말고
 * 화면에서 맞춰 보인다**: 「3건 · 그중 안 끝난 것 2건」. 그러면 위의 2와
 * 이어지고, 아무도 계산기를 안 켠다.
 */
export interface NoDueSplit {
  /** 기한 없는 업무 전부(완료 포함). 달력에 안 서는 것은 이만큼이다. */
  total: number;
  /** 그중 아직 안 끝난 것. 위 네 숫자의 「기한 없음」과 이어진다. */
  open: number;
}

export function noDueSplit(tasks: TaskRow[]): NoDueSplit {
  const none = tasks.filter((t) => !t.dueDate);
  return { total: none.length, open: none.filter((t) => t.status !== "done").length };
}

/**
 * 한 칸에 세울 것과 접을 것.
 *
 * 접되 **몇 개가 접혔는지는 보인다.** 조용히 자르면 그 날에 몇 건이 있는지
 * 세어 볼 수가 없다 — 목록의 `＋n` 과 같은 규칙이다.
 */
export function cellItems(rows: TaskRow[], max = CELL_MAX): { shown: TaskRow[]; more: number } {
  if (rows.length <= max) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, max), more: rows.length - max };
}

/** 이 달의 업무 수 — 격자 위에 적는다. 앞뒤 달에서 딸려 온 칸은 안 센다. */
export function monthCount(tasks: TaskRow[], ym: string): number {
  return tasks.filter((t) => t.dueDate !== null && monthOf(t.dueDate) === ym).length;
}

/** 가오픈일(KST 달력 날짜). 달력에서 그 칸을 강조한다. */
export function openDay(openAtMs: number, timeZone = "Asia/Seoul"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(openAtMs));
}
