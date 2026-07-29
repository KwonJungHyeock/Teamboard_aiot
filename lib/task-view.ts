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
  startDate: string | null;
  dueDate: string | null;
  goalIds: number[];
  progress: number;
  createdByName: string | null;
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

export function dday(due: string | null, today: string): { text: string | null; overdue: boolean } {
  if (!due || !today) return { text: null, overdue: false };
  const diff = Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
  );
  return {
    text: diff < 0 ? `D+${-diff}` : diff === 0 ? "D-DAY" : `D-${diff}`,
    overdue: diff < 0,
  };
}
