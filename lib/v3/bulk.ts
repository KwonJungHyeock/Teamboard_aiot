// v3 「업무」 — 여러 건 한 번에 고치기 + 실행 취소 (MD-P-2026-057 §B).
//
// ══ 무엇을 보내는가 ═══════════════════════════════════════════════
//
// **새 API 는 없다.** 기존 `PATCH /api/tasks/{id}` 를 **건마다 한 번씩** 부른다.
// 046 §B-1 에서 이미 대조한 그 라우트이고, 받는 이름도 그때 확인한 그대로다.
//
//   상태  `status`      todo · doing · review · done
//   담당  `assigneeId`  숫자 또는 null (falsy 면 null 로 저장된다)
//   기한  `dueDate`     `YYYY-MM-DD`, 빈 문자열이면 null (지우는 길)
//
// ══ 중단(dropped)은 안 보낸다 ═════════════════════════════════════
//
// `status: "dropped"` 는 `dropReason` 이 필수다(046 §B-1 ①). 여러 건을 한
// 사유로 묶어 중단하는 것은 사유가 아니라 형식이다. 게다가 되돌릴 때 그 사유를
// 되살릴 방법이 없다 — 목록은 `dropReason` 을 안 들고 있다.
// **되돌릴 수 없는 것은 여기서 안 바꾼다.**
//
// ══ 되돌리기는 「직전 값」이다 ═════════════════════════════════════
//
// 「전부 todo 로」가 아니다. 건마다 원래 값이 다르다. 그래서 보내기 **전에**
// 각 건의 그 칸 값을 손에 들고(`before`), 되돌릴 때 그것을 그대로 돌려보낸다.
// 성공한 건만 되돌린다 — 실패한 건은 애초에 안 바뀌었다.
//
// ══ 한 건이 거부돼도 나머지는 간다 ════════════════════════════════
//
// 전부 되돌리면 열여덟 건을 사람이 다시 해야 한다. 차례로 보내고, 실패한 것만
// 따로 세어 **몇 건이 왜 안 됐는지** 적는다.

import { STATUS_CHOICES } from "./detail";

/** 한 번에 바꿀 수 있는 칸. 셋뿐이다. */
export type BulkField = "status" | "assignee" | "due";

/** 목록 행에서 되돌리기에 필요한 만큼만. `TodayTask` 가 이미 다 들고 있다. */
export interface BulkTask {
  id: number;
  title: string;
  status: string;
  assigneeId: number | null;
  dueDate: string | null;
}

/** 무엇으로 바꾸는가. `assignee`·`due` 의 `null` 은 **지운다**는 뜻이다. */
export type BulkChange =
  | { field: "status"; value: string }
  | { field: "assignee"; value: number | null }
  | { field: "due"; value: string | null };

/** 상태 고르개 — 상세와 **같은 목록**에서 나온다. 여기서 다시 적지 않는다. */
export const BULK_STATUS = STATUS_CHOICES;

/** 「바꾸기 전 값」 한 칸. 되돌리기는 이것만 보고 만든다. */
export interface Before {
  id: number;
  title: string;
  status: string;
  assigneeId: number | null;
  dueDate: string | null;
}

export function beforeOf(t: BulkTask): Before {
  return { id: t.id, title: t.title, status: t.status, assigneeId: t.assigneeId, dueDate: t.dueDate };
}

/** 서버에 보낼 몸통 하나. */
export type Patch = Record<string, unknown>;

/**
 * 바꿀 값 → `PATCH` 몸통.
 *
 * 기한을 지울 때 `null` 이 아니라 **빈 문자열**을 보낸다. 라우트는 `dueDate` 가
 * `YYYY-MM-DD` 가 아니면 null 로 저장하는데, `undefined` 와 구별되려면 키가
 * 있어야 한다 — `""` 는 「키는 있고 값은 날짜가 아니다」라서 지우기가 된다.
 */
export function patchFor(c: BulkChange): Patch {
  if (c.field === "status") return { status: c.value };
  if (c.field === "assignee") return { assigneeId: c.value };
  return { dueDate: c.value ?? "" };
}

/** 되돌리기 몸통 — 그 건의 **직전 값**으로. 건마다 다르다. */
export function undoPatch(b: Before, field: BulkField): Patch {
  if (field === "status") return { status: b.status };
  if (field === "assignee") return { assigneeId: b.assigneeId };
  return { dueDate: b.dueDate ?? "" };
}

/**
 * 이미 그 값인 건은 **안 보낸다.**
 *
 * 열아홉 건을 고르고 그중 열둘이 이미 「진행 중」이면, 열둘은 보낼 이유가 없다.
 * 보내면 서버 일이 늘고, 되돌리기 목록에도 「안 바뀐 건」이 섞여서 「19건
 * 바꿨습니다」가 거짓말이 된다.
 */
export function needsChange(t: BulkTask, c: BulkChange): boolean {
  if (c.field === "status") return t.status !== c.value;
  if (c.field === "assignee") return (t.assigneeId ?? null) !== c.value;
  return (t.dueDate ?? null) !== (c.value ?? null);
}

/** 한 건의 결과. 실패는 **사유를 들고 있다** — 건수만 세면 왜인지 모른다. */
export interface Outcome {
  id: number;
  title: string;
  ok: boolean;
  why: string;
}

export interface BulkResult {
  field: BulkField;
  /** 실제로 보낸 건 중 성공한 것. 되돌리기는 이것만 되돌린다. */
  done: Before[];
  failed: Outcome[];
  /** 이미 그 값이라 안 보낸 건. 「19건 중 7건은 이미 그 값이었습니다」 */
  skipped: number;
}

export function emptyResult(field: BulkField): BulkResult {
  return { field, done: [], failed: [], skipped: 0 };
}

const FIELD_LABEL: Record<BulkField, string> = {
  status: "상태", assignee: "담당", due: "기한",
};

/**
 * 결과 한 줄.
 *
 * **안 사라진다.** 닫기를 눌러야 없어진다(047 §B 와 같은 결). 그래서 문장이
 * 시간이 지나도 말이 되어야 한다 — 「방금」 같은 말을 안 쓴다.
 */
export function resultNote(r: BulkResult): string {
  const f = FIELD_LABEL[r.field];
  const parts: string[] = [];
  if (r.done.length > 0) parts.push(`${f} ${r.done.length}건 바꿨습니다`);
  if (r.failed.length > 0) parts.push(`${r.failed.length}건은 안 됐습니다`);
  if (r.skipped > 0) parts.push(`${r.skipped}건은 이미 그 값이었습니다`);
  if (parts.length === 0) return `${f} — 바꿀 것이 없었습니다`;
  return parts.join(" · ");
}

/** 실패 사유를 **건마다** 적는다. 같은 사유끼리 묶되 건수와 제목을 남긴다. */
export function failLines(r: BulkResult): string[] {
  const by = new Map<string, string[]>();
  for (const f of r.failed) {
    const list = by.get(f.why) ?? [];
    list.push(f.title);
    by.set(f.why, list);
  }
  return Array.from(by.entries()).map(([why, titles]) =>
    `${why} — ${titles.length}건 (${titles.slice(0, 3).join(" · ")}${titles.length > 3 ? " 외" : ""})`);
}

/** 「19건 선택」. 0이면 작업 줄을 아예 안 그린다(지시 §B ⑤). */
export function selectionNote(n: number): string {
  return `${n}건 선택`;
}

/** 차례로 보내는 동안의 진행 — 「3 / 19 보내는 중」. */
export function progressNote(sent: number, total: number): string {
  return `${sent} / ${total} 보내는 중…`;
}

/**
 * 서버가 준 몸통에서 사유를 꺼낸다.
 *
 * 라우트는 `{ error: "…" }` 로 준다(046 §B-1). 못 꺼내면 **상태 코드를 적는다** —
 * 「실패했습니다」만 적으면 사람이 다음에 무엇을 할지 모른다.
 */
export function whyFrom(status: number, body: unknown): string {
  const e = (body as { error?: unknown } | null)?.error;
  if (typeof e === "string" && e.trim() !== "") return e.trim();
  if (status === 403) return "권한이 없습니다.";
  if (status === 404) return "업무를 찾을 수 없습니다.";
  return `서버가 ${status} 로 거부했습니다.`;
}

/**
 * 고른 것 중 **지금 목록에 없는 것은 뺀다.**
 *
 * 거르개를 바꾸면 고른 행이 화면에서 사라질 수 있다. 안 보이는 것을 바꾸면
 * 사람은 무엇이 바뀌었는지 못 본다.
 */
export function pruneSelection(sel: Set<number>, visible: readonly BulkTask[]): Set<number> {
  const ids = new Set(visible.map((t) => t.id));
  const next = new Set<number>();
  sel.forEach((id) => { if (ids.has(id)) next.add(id); });
  return next;
}
