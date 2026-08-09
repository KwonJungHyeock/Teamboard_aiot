// 업무 화면 공용 — 뷰(렌즈) 타입·상태 메타·색·D-day. 시트/보드/캘린더/타임라인이 공유.

export interface TaskItem {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  origin: string;
  projectId: number | null;
  projectName: string | null;
  colorKey: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  areaId: number;
  areaName: string;
  workType: string;
  /** MD-P-2026-025 §B2 — 개인 업무 칩 표시용 */
  visibility?: "team" | "private";
  startDate: string | null;
  dueDate: string | null;
  goalIds: number[];
  progress: number;
  createdByName: string | null;
  blocked: boolean;
  blockedReason: string | null;
  /** 완료 시각 — 완료 업무는 D+ 대신 이 날짜를 보여준다 (MD-P-2026-018 §E) */
  completedAt?: string | null;
  createdAt?: string | null;
  /** §A3 계층 (MD-P-2026-028) — 목록이 접기/펼치기를 그릴 재료 */
  parentTaskId?: number | null;
  childCount?: number;
  /** §C — "직접 정한 순서" */
  sortOrder?: number;
  /** §B3 — 차단 원인 업무 */
  blockedBy?: number | null;
}

export type TaskLens = "sheet" | "board" | "calendar" | "timeline";
export type BoardGroup = "status" | "area" | "assignee";

export const LENS_LABEL: Record<TaskLens, string> = {
  sheet: "시트",
  board: "보드",
  calendar: "캘린더",
  timeline: "타임라인",
};

export const GROUP_LABEL: Record<BoardGroup, string> = {
  status: "상태",
  area: "영역",
  assignee: "담당",
};

// 보드 상태 컬럼 (제안·중단 제외 — 제안은 인박스, 중단은 상세에서만)
export const BOARD_STATUSES = ["todo", "doing", "review", "done"] as const;

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  todo: { label: "대기", tone: "todo" },
  doing: { label: "진행", tone: "doing" },
  review: { label: "리뷰", tone: "review" },
  done: { label: "완료", tone: "done" },
  proposed: { label: "제안", tone: "prop" },
  dropped: { label: "중단", tone: "drop" },
};

// LED 상태 점 색 = 의미색(솔리드·무발광). 진척 바 색도 동일.
export function statusColor(status: string): string {
  switch (status) {
    case "doing": return "var(--edu)";
    case "review": return "var(--amber)";
    case "done": return "var(--green)";
    case "dropped": return "var(--line-hi)";
    default: return "var(--muted)"; // todo
  }
}

export function areaColor(colorKey: string | null): string {
  switch (colorKey) {
    case "play": case "purple": return "var(--play)";
    case "green": case "train": return "var(--green)";
    case "amber": return "var(--amber)";
    case "coral": return "var(--coral)";
    case "team": return "var(--team)";
    case "edu": case "blue": default: return "var(--edu)";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 날짜 유틸 (date-only, KST 안전) — 캘린더·타임라인·홈이 공유하는 단일 소스.
// 규칙: 날짜는 항상 YYYY-MM-DD 문자열. new Date(str)(UTC 파싱) 금지 — 아래 함수만 사용.
// Date.UTC(y,m,d)는 tz 영향이 없어 결정적이고, "today"도 서버 KST date-only 문자열이라 문자열 비교로 안전.
// ─────────────────────────────────────────────────────────────────────────
export function ymd(d: string | null | undefined): string | null {
  return d ? d.slice(0, 10) : null;
}
export function dateAddDays(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day) + n * 86400000).toISOString().slice(0, 10);
}
/** b에서 a까지의 일수(a-b). 둘 다 date-only. UTC 자정 기준 결정적 계산. */
export function dateDiffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}
/** 업무의 표시 기간(inclusive). 시작·마감 중 하나만 있으면 단일(그날 1칸).
 *  순서가 뒤집혀 있으면 정규화한다. 둘 다 없으면 null. — 캘린더 span·타임라인 바·홈 공통. */
export function taskDays(task: { startDate: string | null; dueDate: string | null }): { start: string; end: string } | null {
  const s0 = ymd(task.startDate) ?? ymd(task.dueDate);
  const e0 = ymd(task.dueDate) ?? ymd(task.startDate);
  if (!s0 || !e0) return null;
  return s0 <= e0 ? { start: s0, end: e0 } : { start: e0, end: s0 };
}

export function dday(due: string | null, today: string): {
  text: string | null; overdue: boolean; soon: boolean;
} {
  if (!due || !today) return { text: null, overdue: false, soon: false };
  const diff = Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
  );
  return {
    text: diff < 0 ? `D+${-diff}` : diff === 0 ? "D-DAY" : `D-${diff}`,
    overdue: diff < 0,
    soon: diff >= 0 && diff <= 7,
  };
}

/**
 * 기한 급함 등급 — **여기 하나만 쓴다** (MD-P-2026-031 H-2).
 *
 * 화면마다 `/^D-[0-2]$/` 같은 정규식을 따로 쓰고 있었다. 그러면 "이번 주"의 뜻이
 * 화면마다 달라지고, 지연이 어디선 빨갛고 어디선 회색이 된다. 진척 계산기가
 * 아홉 갈래로 갈렸던 것과 같은 경로다.
 *
 * `D+N` 지연 · `D-DAY ~ D-7` 임박 · 그 외 보통. 문자열만 있어도 판정한다 —
 * 홈처럼 서버가 만든 라벨만 들고 있는 화면이 있기 때문이다.
 */
export type DueUrgency = "late" | "soon" | "normal";
export function dueUrgency(ddayText: string | null | undefined): DueUrgency {
  if (!ddayText) return "normal";
  if (/^D\+\d+$/.test(ddayText)) return "late";
  if (ddayText === "D-DAY") return "soon";
  const m = /^D-(\d+)$/.exec(ddayText);
  if (m && Number(m[1]) <= 7) return "soon";
  return "normal";
}

/**
 * 기한 표기 (MD-P-2026-018 §E).
 * 완료·중단된 업무에 D+26 을 계속 띄우면 아직 지연 중인 것으로 읽힌다.
 * 끝난 업무는 "완료 2026-07-09" 처럼 끝난 날을 보여주고, 날짜가 없으면 "완료"만 —
 * 없는 날짜를 추정하지 않는다.
 */
export function dueLabel(
  task: { status: string; dueDate: string | null; completedAt?: string | null },
  today: string
): { text: string | null; overdue: boolean; done: boolean } {
  if (task.status === "done" || task.status === "dropped") {
    const label = task.status === "done" ? "완료" : "중단";
    const day = task.completedAt ? task.completedAt.slice(0, 10) : null;
    return { text: day ? `${label} ${day}` : label, overdue: false, done: true };
  }
  const d = dday(task.dueDate, today);
  return { ...d, done: false };
}
