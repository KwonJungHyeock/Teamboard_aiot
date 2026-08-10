// MD-P-2026-031 §C2 · §D6 — 기한 막대의 기하(幾何).
//
// **여기가 막대 위치의 유일한 출처다.** 홈·업무 목록·프로젝트 상세·영역 상세 넷이
// 같은 컴포넌트를 쓰고, 그 컴포넌트가 이 함수 하나를 쓴다.
// 화면마다 퍼센트를 따로 계산하면 같은 업무가 화면마다 다른 자리에 놓인다 —
// 진척 계산기가 아홉 갈래로 갈렸던 것과 같은 경로다.
//
// 좌표는 **구간 폭에 대한 백분율**이다. 픽셀은 CSS 가 정한다.
import { dateDiffDays, ymd } from "./task-view";

export interface BarRange {
  /** 표시 구간 시작·끝 (YYYY-MM-DD, 양 끝 포함) */
  start: string;
  end: string;
  today: string;
}

export interface BarGeometry {
  /** 구간 안에 그릴 막대가 있는가. 없으면 stub 을 그린다. */
  visible: boolean;
  /** 왼쪽·폭 (%) */
  left: number;
  width: number;
  /** 오늘 선 위치 (%). 구간 밖이면 null */
  todayAt: number | null;
  /** 기한이 구간 밖이라 막대를 못 그리는 경우 — 어느 쪽인지와 날짜 */
  stub: { side: "before" | "after"; date: string } | null;
  /** 마감을 넘겼는가 (막대에 코랄 링) */
  over: boolean;
}

/** 구간의 날짜 수. 양 끝을 포함하므로 +1. */
export function rangeDays(r: BarRange): number {
  return Math.max(1, dateDiffDays(r.end, r.start) + 1);
}

/** 구간 안에서 그 날짜가 차지하는 왼쪽 위치(%). 구간 밖이면 0~100 밖의 값이 나온다. */
export function dayPercent(day: string, r: BarRange): number {
  return (dateDiffDays(day, r.start) / rangeDays(r)) * 100;
}

/**
 * 업무 하나의 막대.
 *
 * - 시작·마감 중 하나만 있으면 그날 하루짜리로 본다 (`taskDays` 와 같은 규칙).
 * - 둘 다 없으면 막대가 없다. **없는 기간을 추정하지 않는다.**
 * - 구간을 벗어난 쪽은 잘라서 그린다. 통째로 벗어나면 `stub` 으로 방향과 날짜를 준다 —
 *   **안 보이는 지연은 없는 지연으로 읽힌다**(회신 1 · 2-1).
 */
export function taskBar(
  task: { startDate?: string | null; dueDate?: string | null; status?: string },
  r: BarRange
): BarGeometry {
  const none: BarGeometry = { visible: false, left: 0, width: 0, todayAt: todayPercent(r), stub: null, over: false };
  const s0 = ymd(task.startDate ?? null) ?? ymd(task.dueDate ?? null);
  const e0 = ymd(task.dueDate ?? null) ?? ymd(task.startDate ?? null);
  if (!s0 || !e0) return none;
  const [s, e] = s0 <= e0 ? [s0, e0] : [e0, s0];

  const done = task.status === "done" || task.status === "dropped";
  const over = !done && e < r.today;

  if (e < r.start) return { ...none, stub: { side: "before", date: e }, over };
  if (s > r.end) return { ...none, stub: { side: "after", date: e }, over };

  const days = rangeDays(r);
  const from = Math.max(0, dateDiffDays(s, r.start));
  const to = Math.min(days, dateDiffDays(e, r.start) + 1);
  return {
    visible: to > from,
    left: (from / days) * 100,
    width: ((to - from) / days) * 100,
    todayAt: todayPercent(r),
    stub: null,
    over,
  };
}

function todayPercent(r: BarRange): number | null {
  if (r.today < r.start || r.today > r.end) return null;
  return dayPercent(r.today, r);
}

/**
 * 눈금.
 * - 한 달 구간이면 1 · 8 · 15 · 22 · 말일.
 * - 여러 달이면 **월 경계**에 눈금을 놓는다(`7월` · `8월` · `9월`).
 *   여러 달 구간에서 날짜를 다섯 개 찍으면 눈이 기준을 못 잡는다 — 달이 기준이다.
 */
export function ticks(r: BarRange): { at: number; label: string }[] {
  const days = rangeDays(r);
  const same = r.start.slice(0, 7) === r.end.slice(0, 7);
  const out: { at: number; label: string }[] = [];
  if (same) {
    const seen = new Set<number>();
    for (const i of [0, 7, 14, 21, days - 1]) {
      if (i < 0 || i >= days || seen.has(i)) continue;
      seen.add(i);
      out.push({ at: (i / days) * 100, label: String(Number(addDays(r.start, i).slice(8, 10))) });
    }
    return out;
  }
  for (let i = 0; i < days; i++) {
    const day = addDays(r.start, i);
    if (i === 0 || day.slice(8, 10) === "01") {
      out.push({ at: (i / days) * 100, label: `${Number(day.slice(5, 7))}월` });
    }
  }
  return out;
}

/**
 * 이번 분기 (§C 회신 3-1) — **홈 목록의 기본 구간이다.**
 * 한 달 눈금은 우리 업무 주기보다 짧다. 7월에 시작해 9월까지 가는 일이 전부
 * 구간 밖으로 나가면, 화살표 열여섯 개가 줄줄이 서고 그건 정보가 아니라 소음이다.
 */
export function quarterRange(today: string): BarRange {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;          // 1 · 4 · 7 · 10
  const start = `${y}-${String(q0).padStart(2, "0")}-01`;
  const endM = q0 + 2;
  const last = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  return { start, end: `${y}-${String(endM).padStart(2, "0")}-${String(last).padStart(2, "0")}`, today };
}

/**
 * 전체 기간 — 대상의 min(시작) ~ max(마감), 양쪽 5% 여백.
 * **오늘이 범위 밖이면 그 범위를 쓰지 않는다** — 오늘 선이 없는 시간축은 읽을 기준이 없다.
 * 날짜가 하나도 없으면 분기로 떨어진다.
 */
export function spanRange(
  tasks: { startDate?: string | null; dueDate?: string | null }[],
  today: string
): BarRange {
  const days = tasks
    .flatMap((t) => [ymd(t.startDate ?? null), ymd(t.dueDate ?? null)])
    .filter((d): d is string => !!d)
    .sort();
  if (!days.length) return quarterRange(today);
  let start = days[0] < today ? days[0] : today;
  let end = days[days.length - 1] > today ? days[days.length - 1] : today;
  const pad = Math.max(1, Math.round((dateDiffDays(end, start) + 1) * 0.05));
  start = addDays(start, -pad);
  end = addDays(end, pad);
  return { start, end, today };
}

/** 구간 밖이라 막대를 못 그린 행의 비율 — 20% 를 넘으면 **눈금 범위가 틀린 것**이다(§C 회신 3-2).
 *  기한이 없는 행은 분모에서 뺀다. 그건 데이터가 없는 것이지 범위 문제가 아니다. */
export function stubRatio(
  tasks: { startDate?: string | null; dueDate?: string | null; status?: string }[],
  r: BarRange
): { stub: number; drawn: number; total: number; pct: number } {
  let stub = 0, drawn = 0;
  for (const t of tasks) {
    const g = taskBar(t, r);
    if (g.stub) stub++;
    else if (g.visible) drawn++;
  }
  const total = stub + drawn;
  return { stub, drawn, total, pct: total ? Math.round((stub / total) * 1000) / 10 : 0 };
}

function addDays(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day) + n * 86400000).toISOString().slice(0, 10);
}

/** 그 달의 1일 ~ 말일. 홈·영역 상세가 기본 구간으로 쓴다. */
export function monthRange(today: string): BarRange {
  const [y, m] = today.split("-").map(Number);
  const start = `${today.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`, today };
}
