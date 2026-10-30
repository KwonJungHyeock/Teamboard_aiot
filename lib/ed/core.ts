// 디자인 v1.0 공통 규칙 — 날짜 표기 · 상태 판정 · 카테고리 색 · 등록창 문법.
// 화면마다 따로 적지 않는다. 클라이언트 · 서버 어디서나 불러도 되는 순수 함수만 둔다.

export type Status = "todo" | "doing" | "review" | "hold" | "done";
/** 화면 상태 — `over`(지남)는 저장값이 아니라 계산값이다 (DESIGN.md 6장) */
export type Look = "over" | Status;

export interface EdTask {
  id: number; title: string; description: string; status: string;
  assigneeId: number | null; assigneeName: string | null; createdById: number | null; createdByName: string | null;
  areaId: number; areaName: string; dueDate: string | null; startDate: string | null; goalIds: number[];
  parentTaskId: number | null; childCount: number; childCounted: number; progress: number;
  completedAt: string | null; createdAt: string; visibility: string;
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];

/** 오늘(KST) YYYY-MM-DD */
export function todayKst(now = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}
export function weekday(iso: string): number { return new Date(`${iso}T00:00:00Z`).getUTCDay(); }
export function wd(iso: string): string { return WD[weekday(iso)]; }
/** `2일(월)` · `24일(오늘)` */
export function dayLabel(iso: string, today = todayKst()): string {
  const d = Number(iso.slice(8, 10));
  return iso === today ? `${d}일(오늘)` : `${d}일(${wd(iso)})`;
}
/** `10.24` */
export function md(iso: string): string { return `${iso.slice(5, 7)}.${iso.slice(8, 10)}`; }
/** `10.28(수)` */
export function mdw(iso: string): string { return `${md(iso)}(${wd(iso)})`; }
/** 이번 주 월요일 */
export function mondayOf(iso: string): string { const w = weekday(iso); return addDays(iso, w === 0 ? -6 : 1 - w); }

/** 상태 판정 — 지남은 기한 < 오늘 && 미완 */
export function lookOf(t: { status: string; dueDate: string | null }, today = todayKst()): Look {
  if (t.status === "done") return "done";
  // 보류는 멈춰 둔 것 — 기한이 지나도 「지남」으로 재촉하지 않는다
  if (t.status === "hold") return "hold";
  if (t.dueDate && t.dueDate < today) return "over";
  if (t.status === "doing") return "doing";
  if (t.status === "review") return "review";
  return "todo";
}
export const LOOK_LABEL: Record<Look, string> = { over: "지남", doing: "진행", review: "검토", todo: "시작 전", hold: "보류", done: "완료" };
export const LOOK_COLOR: Record<Look, string> = {
  over: "var(--red)", doing: "var(--accent)", review: "var(--review)", todo: "var(--faint)", hold: "var(--amber)", done: "var(--green)",
};
export const STATUS_LABEL: Record<Status, string> = { todo: "시작 전", doing: "진행", review: "검토", hold: "보류", done: "완료" };

/** 기한 배지 — 지남 red / 오늘·내일 amber / 그 외 무채 */
export function dueBadge(due: string | null, status: string, today = todayKst()): { text: string; tone: "" | "red" | "amber" | "green" } {
  if (status === "done") return { text: "완료", tone: "green" };
  if (!due) return { text: "—", tone: "" };
  const n = diffDays(due, today);
  if (n < 0) return { text: `${-n}일 지남`, tone: "red" };
  if (n === 0) return { text: "오늘", tone: "amber" };
  if (n === 1) return { text: "내일", tone: "amber" };
  return { text: mdw(due), tone: "" };
}
export function dMinus(due: string | null, today = todayKst()): string {
  if (!due) return "";
  const n = diffDays(due, today);
  return n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`;
}

/** 카테고리(=area) 색 — 시안의 CATS 순서 그대로 */
const CAT: Record<string, string> = {
  "R&D": "var(--violet)", "플랫폼": "var(--accent)", "교육자료": "var(--green)",
  "디자인": "var(--rose)", "연구소": "var(--amber)", "현장실습교육": "var(--teal)",
};
// 새로 만든 카테고리 — 이름으로 늘 같은 색을 고른다(만든 사람 · 화면마다 달라지지 않게)
const CAT_MORE = ["var(--violet)", "var(--accent)", "var(--green)", "var(--rose)", "var(--amber)", "var(--teal)"];
export function catColor(name: string | null | undefined): string {
  if (!name) return "var(--sub)";
  if (CAT[name]) return CAT[name];
  if (name === "기타") return "var(--sub)";
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAT_MORE[h % CAT_MORE.length];
}

// 담당자 색 — 달력 막대 · 점 · 필터 견본이 같은 색을 쓴다. 빨강(지남) · violet(팀 일정) · teal(나만)은 피한다.
const PERSON = ["#2F6FDE", "#E07A1F", "#2E9E5B", "#D6457A", "#B8900E", "#4F6BAA", "#A3409F", "#5E8C1F", "#8A5A2B", "#C26A4E", "#3A8FA8", "#6B7280"];
/** 구성원 순서(meta.people)대로 색을 나눠 준다 — 화면마다 같은 사람은 같은 색 */
export function personColors(people: { id: number }[]): Map<number, string> {
  return new Map(people.map((p, i) => [p.id, PERSON[i % PERSON.length]]));
}

export function initial(name: string | null | undefined): string { return (name ?? "?").trim().charAt(0) || "?"; }

/** `n분 전` */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  return md(new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10));
}

// ── 등록창 문법 `@담당 ~마감 #목표` ─────────────────────────────
export const DUE_WORDS = ["오늘", "내일", "금", "다음주"] as const;
export function dueFromWord(w: string, today = todayKst()): string | null {
  if (w === "오늘") return today;
  if (w === "내일") return addDays(today, 1);
  if (w === "금" || w === "금요일") { const n = (5 - weekday(today) + 7) % 7; return addDays(today, n); }
  if (w === "다음주") return addDays(mondayOf(today), 7);
  if (/^\d{1,2}[./]\d{1,2}$/.test(w)) {
    const [m, d] = w.split(/[./]/).map(Number);
    let y = Number(today.slice(0, 4));
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso < today) y += 1;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}
export interface Parsed { title: string; who: string | null; due: string | null; tag: string | null }
export function parseLine(text: string): Parsed {
  const w = text.match(/@(\S+)/), d = text.match(/~(\S+)/), g = text.match(/#(\S+)/);
  return {
    title: text.replace(/[@~#]\S+/g, "").replace(/\s+/g, " ").trim(),
    who: w ? w[1] : null, due: d ? d[1] : null, tag: g ? g[1] : null,
  };
}

/** 한글 조합 중 Enter 는 무시한다 */
export function isEnter(e: { key: string; nativeEvent: { isComposing?: boolean }; keyCode?: number }): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
}
