// v3 「오늘」 — **화면이 받은 것을 세는 규칙만.** 순수 함수다 (MD-P-2026-043 §C-1).
//
// ── 왜 여기 따로 있는가 ─────────────────────────────────────────
//
// 이번 회차는 **API 를 안 건드린다.** 그래서 이 화면은 기존 엔드포인트 둘을
// 그대로 먹는다 — `/api/tasks` 와 `/api/notifications`. 두 응답에서 화면이
// 묻는 것(진행 중 몇 · 오늘 할 일 · 오늘 마친 것)을 **뽑는 규칙**이 여기 있다.
//
// 규칙을 화면 안에 두지 않는 이유: 검사기가 같은 함수를 부르지 못하면
// 「화면이 자기가 그린 것을 그대로 그렸다」밖에 확인 못 한다.
// 여기 있으면 검사기가 **DB 에서 직접 센 값**과 맞춰 볼 수 있다.
//
// 오늘 날짜도 **인자로 받는다.** 시스템 시계를 읽으면 경계(어제·오늘·내일)를
// 검사기가 만들 수 없다.

/** `/api/tasks` 가 주는 것 중 이 화면이 쓰는 칸만. */
export interface TodayTask {
  id: number;
  title: string;
  status: string;
  dueDate: string | null;
  assigneeName: string | null;
  areaId: number | null;
  completedAt: string | null;
  parentTaskId: number | null;
}

/** 진행 중으로 세는 상태 — `/api/tasks` 기본 목록과 같은 뜻. */
const OPEN = new Set(["todo", "doing", "review"]);

export interface TodayCounts {
  doing: number;
  thisWeek: number;
  noDue: number;
}

/**
 * 큰 숫자 셋.
 *
 * · 진행 중   — todo · doing · review
 * · 이번 주 마감 — 오늘부터 이번 주 일요일까지. **지난 것은 안 센다**
 *   (지난 것은 「오늘 할 일」에 이미 서 있고, 두 번 세면 합이 안 맞는다)
 * · 기한 없음 — 진행 중인데 기한이 없는 것. 아무 날에도 안 걸려서
 *   **마지막까지 안 보이는 것들**이라 호박색으로 따로 센다.
 */
export function countToday(tasks: TodayTask[], today: string): TodayCounts {
  const open = tasks.filter((t) => OPEN.has(t.status));
  return {
    doing: open.length,
    thisWeek: open.filter((t) => t.dueDate !== null
      && t.dueDate >= today && t.dueDate <= weekEnd(today)).length,
    noDue: open.filter((t) => t.dueDate === null).length,
  };
}

/** `2026-09-13` → `9/13`. 앞의 0 을 떼서 짧게 (044 §A). */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 이번 주 일요일(KST). 오늘이 일요일이면 오늘이다. */
export function weekEnd(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay();                 // 0=일
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? 0 : 7 - dow));
  return d.toISOString().slice(0, 10);
}

/**
 * 「오래 밀린 일」의 경계. 이보다 더 지난 것은 오늘 할 일이 아니다.
 *
 * 지시자 정정(044 §A): 두 달 밀린 업무는 **오늘 할 일이 아니라 기한을 다시
 * 정할 일**이다. 043 에서는 지난 것을 전부 「오늘 할 일」에 넣었고, 그러면
 * 12건 중 11건이 코랄이 되어 **강조가 배경이 된다.**
 */
export const STALE_DAYS = 7;

export interface TodayLists {
  /** 오늘 마감 + 지남 7일 이내. **코랄 테두리는 여기에만.** */
  todo: (TodayTask & { late: boolean })[];
  /** 지남 7일 초과. 접힌 줄 하나로 들어간다 — 회색. */
  stale: (TodayTask & { late: boolean })[];
  /** 오늘 완료 처리된 것. */
  done: TodayTask[];
}

/**
 * `due` 가 `today` 보다 **며칠 지났는가**. 안 지났으면 0 이하.
 *
 * 둘 다 `YYYY-MM-DD` 인 날짜값이라 UTC 자정으로 정규화해 빼면 **달력 날짜
 * 차이**가 그대로 나온다. 밀리초를 나누는 것이 아니라 날짜를 세는 것이다.
 */
export function daysLate(due: string, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000
  );
}

/**
 * 「오늘 할 일」과 「오늘 마친 것」.
 *
 * 할 일은 **지난 것 먼저, 그다음 오늘**이다. 그 안에서는 기한이 오래된 순 —
 * 오래 밀린 것이 위로 온다.
 *
 * 마친 것은 `completed_at` 이 오늘인 것만. 상태가 done 이어도 어제 마친 것은
 * 오늘의 성과가 아니다.
 */
export function splitToday(tasks: TodayTask[], today: string): TodayLists {
  // 기한이 오늘이거나 지난 것 전부 — 여기서 둘로 가른다.
  const due = tasks
    .filter((t) => OPEN.has(t.status) && t.dueDate !== null && t.dueDate <= today)
    .map((t) => ({ ...t, late: (t.dueDate as string) < today }))
    .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string) || a.id - b.id);

  // **합이 새지 않는다** — `todo` + `stale` 이 곧 `due` 다. 어느 쪽에도 안 드는
  // 업무가 생기면 그 업무는 어디에서도 안 보인다.
  const todo = due.filter((t) => daysLate(t.dueDate as string, today) <= STALE_DAYS);
  const stale = due.filter((t) => daysLate(t.dueDate as string, today) > STALE_DAYS);

  const done = tasks
    .filter((t) => t.status === "done" && kstDate(t.completedAt) === today)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || a.id - b.id);

  return { todo, stale, done };
}

/** 접힌 줄에 적을 말. 「몇 건인지」와 「얼마나 오래됐는지」를 함께 낸다. */
export function staleLine(stale: TodayTask[]): string | null {
  if (stale.length === 0) return null;
  const oldest = stale.reduce((a, b) =>
    (a.dueDate as string) <= (b.dueDate as string) ? a : b);
  const [, m, d] = (oldest.dueDate as string).split("-");
  return `오래 밀린 일 ${stale.length}건 · 가장 오래된 것 ${Number(m)}월 ${Number(d)}일`;
}

/**
 * 타임스탬프를 **KST 달력 날짜**로. 글자를 잘라 쓰지 않는다.
 *
 * 처음엔 `completedAt.slice(0, 10)` 이었다. `/api/tasks` 는 UTC 로 주므로
 * **KST 09:00 이전에 마친 업무가 「어제」로 읽혀 오늘 목록에서 사라졌다.**
 * 검사기가 「오늘 마침 0행」으로 잡았다. 시각이 붙은 값을 날짜로 볼 때는
 * 어느 시간대의 달력인지 정하고 봐야 한다.
 */
export function kstDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

/** 하위가 있을 때만 붙는 한 줄. 없으면 `null` — 없는 줄을 그리지 않는다. */
export function childLine(task: TodayTask, all: TodayTask[]): string | null {
  const kids = all.filter((t) => t.parentTaskId === task.id);
  if (kids.length === 0) return null;
  const done = kids.filter((k) => k.status === "done").length;
  return `하위 ${kids.length}개 중 ${done}개 완료`;
}

/** 목록에 쓰는 기한 표시 — `MM-DD`. 연도는 안 쓴다(오늘 근처만 나온다). */
export function shortDue(due: string | null): string | null {
  return due ? due.slice(5) : null;
}

/* ── 받은함 ──────────────────────────────────────────────────────
   `/api/notifications` 의 항목 중 **처리할 것**만. 읽음 표시된 것도 남긴다 —
   읽었다고 처리한 것은 아니다. */
export interface InboxItem {
  id: number;
  type: string;
  snippet: string;
  refType: string;
  refId: number | null;
  createdAt: string;
  read: boolean;
  actorName: string | null;
}

/** 받은함에 올리는 종류. 그 밖(시스템 공지 등)은 여기 자리가 아니다. */
const INBOX_TYPES = new Set(["approval", "mention", "reply", "handover"]);

export function inboxItems(items: InboxItem[]): InboxItem[] {
  return items.filter((i) => INBOX_TYPES.has(i.type));
}
