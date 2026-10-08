// v3 「상세」 — 무엇을 보낼 수 있고 무엇은 못 보내는가 (MD-P-2026-046 §B).
//
// ══ §B-1 조사 결과 — 업무 하나를 바꾸는 API ═══════════════════════
//
// **경로**  `PATCH /api/tasks/{id}`  (`PUT` 과 같은 핸들러다 — `PATCH` 가 `PUT`
//           을 그대로 부른다. 부분 수정이라 `PATCH` 를 쓴다.)
//           `app/api/tasks/[id]/route.ts`
//
// **받는 이름** — 지시서의 다섯 가지가 실재하는지 하나씩 대조했다.
//
//   지시서    보내는 이름       받는 규칙 (route.ts 그대로)
//   ────────  ───────────────  ──────────────────────────────────────────
//   상태      `status`         proposed·todo·doing·review·done·dropped 중 하나.
//                              그 밖은 400 「상태 값이 올바르지 않습니다.」
//   담당      `assigneeId`     숫자면 그 사람, **falsy 면 null**.
//                              `payload.assigneeId ? Number(...) : null`
//   기한      `dueDate`        `YYYY-MM-DD` 만 값으로 받는다. 그 밖(빈 문자열
//                              포함)은 **null 로 저장**된다 — 지우는 길이 이것이다.
//                              `startDate` 와 비교해 시작일>마감일이면 400.
//   제목      `title`          trim 후 200자로 자른다. **빈 문자열은 무시**된다
//                              (`payload.title.trim()` 이 falsy 면 set 안 함).
//   기록      `description`    ← 지시서의 `body` 는 실재하지 않는다(045 §B-1 에서
//                              이미 확인). 컬럼도 `task.description`(text NOT NULL
//                              기본값 '')이고 API 도 `description` 으로 받는다.
//                              4000자에서 자른다.
//
// **덧붙는 규칙 셋** — 화면이 미리 알아야 400/403 을 안 맞는다.
//
//   ① `status: "dropped"` 는 `dropReason` 이 **필수**다(빈 문자열이면 400).
//      → 이 화면은 중단을 안 보낸다. 사유 없는 중단 버튼은 400 만드는 버튼이다.
//   ② `status: "done"` 은 `resolution` 을 같이 받는다(기본 `"done"`).
//      → 안 보낸다. 기본값이 우리가 뜻하는 그 값이다.
//   ③ 지금 상태가 `proposed` 면 상태 전이는 **담당자 본인 또는 팀장만**(403).
//      → 제안 업무는 상태 칸을 안 그리고 이유 한 줄을 적는다.
//
// **안 보내는 것** — `progress` · `priority` · `projectId` · `visibility` ·
// `parentTaskId` · `blocked*` · `goalIds` · `areaId` · `workType` · `startDate` ·
// `isActive`. 받기는 하지만 이번 화면의 일이 아니다. 그중 화면에 **보이는** 값
// (진척)은 칸 없이 이유 한 줄을 단다(§B-2).
//
// **API 는 안 고쳤다.** 이 파일에 있는 것은 전부 위 라우트가 이미 받는 것들이다.
import { GROUPS } from "./tasks";
import { openDueMark } from "../open-due";

/** `GET /api/tasks/{id}` 가 주는 것 중 **이 화면이 쓰는 칸만**. */
export interface DetailTask {
  id: number;
  title: string;
  description: string;
  status: string;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  startDate: string | null;
  areaId: number;
  dropReason: string | null;
  /** 서버가 `lib/progress.ts` 로 계산한 값. **화면은 받아서 그리기만 한다.** */
  effectiveProgress: number;
  rolledUpFromChildren: boolean;
  childCounted: number;
  childDone: number;
  parentTaskId: number | null;
  parentTitle: string | null;
  children: { id: number; title: string; status: string }[];
  /*
   * ── 속성 일곱이 쓰는 칸 (066 §E-37) ──────────────────────────
   * 영역 · 프로젝트 · 목표 · 상위 · 하위 · 우선순위 · 기간.
   * `GET /api/tasks/{id}` 가 **이미 주는 것들**이다 — API 를 안 고쳤다.
   *
   * 셋은 안 넣는다(§E-38): 차단 · 이 업무가 막는 업무 · 공개 범위. 가오픈 뒤다.
   */
  projectId: number | null;
  projectName: string | null;
  priority: string;
  goalIds: number[];
}

export interface ActivityRow {
  id: number; message: string; level: string; created_at: string; user_name: string | null;
}

/**
 * 상태 칸에 세우는 넷.
 *
 * **목록의 묶음 이름을 그대로 쓴다** (`GROUPS`). 같은 상태를 목록에서는
 * 「아직 시작 안 함」, 상세에서는 「할 일」로 부르면 같은 것인지 알 수가 없다.
 * 이름이 두 벌이 되는 순간 어느 쪽이 진짜인지 묻는 사람이 생긴다.
 *
 * `proposed` 와 `dropped` 는 여기 없다 — 위 ①·③ 참조.
 */
export const STATUS_CHOICES = GROUPS.map((g) => ({
  value: g.statuses[0] as string,
  label: g.label,
}));

/** 상태 칸을 그릴 수 있는가. 못 그리면 **이유를 함께** 낸다 (§B-1). */
export function statusEditable(status: string): { ok: boolean; why?: string } {
  if (status === "proposed") {
    return {
      ok: false,
      why: "에이전트가 제안한 업무입니다. 승인·기각은 담당자 본인 또는 팀장이 옛 인박스에서 합니다.",
    };
  }
  if (status === "dropped") {
    return {
      ok: false,
      why: "중단된 업무입니다. 되돌리면 중단 사유가 지워지므로 이 화면에서는 안 바꿉니다.",
    };
  }
  return { ok: true };
}

/**
 * 진척은 **읽기 전용**이다 (§B-2). 왜 못 바꾸는지를 칸 대신 적는다.
 *
 * `lib/progress.ts` 는 안 건드린다 — 계산식은 그대로고, 여기서는 그 결과가
 * 왜 그 숫자인지를 말만 한다.
 */
export function progressWhy(t: Pick<DetailTask,
  "rolledUpFromChildren" | "childCounted" | "childDone">): string {
  if (t.rolledUpFromChildren) {
    return `하위 ${t.childCounted}개 중 ${t.childDone}개 완료로 계산됩니다. 손으로는 안 바뀝니다.`;
  }
  return "진척은 지정된 한 사람만 바꿀 수 있습니다.";
}

/**
 * 기한 옆에 붙는 가오픈 표기.
 *
 * **같은 계산을 다시 쓴다** — `lib/open-due.ts` 의 `openDueMark`. 대문
 * 카운트다운·「오늘」의 D 표기·가오픈 기한 화면이 전부 여기서 나온다.
 * 상세만 따로 세면 같은 업무가 화면마다 다른 날짜를 말하게 된다.
 */
export function dueOpenNote(dueDate: string | null, openAtMs: number): string | null {
  return openDueMark(dueDate, openAtMs).label;
}

/**
 * 보내는 몸통을 **한 곳에서** 만든다.
 *
 * 필드 이름을 화면 여기저기에 흩뿌리면 `body` 같은 오타가 한 곳에서만 고쳐지고
 * 나머지는 조용히 안 저장된다. 이름은 위 표에 적힌 실재하는 것들이다.
 */
export type EditField =
  | "title" | "description" | "status" | "assigneeId" | "dueDate"
  /* 066 §E-37 의 일곱. 이름은 전부 `PATCH /api/tasks/{id}` 가 **이미 받는 것**이다 */
  | "areaId" | "projectId" | "priority" | "startDate" | "parentTaskId" | "goalIds";

/** 칸 이름 → 사람이 읽는 말. 저장 실패 줄과 검사기가 같은 말을 쓴다. */
export const FIELD_LABEL: Record<EditField, string> = {
  title: "제목", description: "기록", status: "상태", assigneeId: "담당", dueDate: "기한",
  areaId: "영역", projectId: "프로젝트", priority: "우선순위", startDate: "시작일",
  parentTaskId: "상위 업무", goalIds: "목표",
};

/**
 * 보내는 몸통. **값이 배열인 칸이 하나 있다**(`goalIds`) — 나머지는 그대로 실린다.
 *
 * 영역을 바꾸면서 프로젝트를 비우는 경우처럼 **둘을 같이 보내야 하는** 자리가
 * 있다. 따로 보내면 첫 요청이 안 맞는 조합이라 400 을 맞는다(§E-44).
 * 그래서 `extra` 를 받는다 — 화면이 아무 이름이나 끼워 넣지 못하게
 * **부르는 쪽이 이름을 적어 넘긴다.**
 */
export function patchBody(
  field: EditField, value: string | number | number[] | null,
  extra?: Partial<Record<EditField, string | number | null>>,
): Record<string, unknown> {
  return { [field]: value, ...(extra ?? {}) };
}

/**
 * 우선순위 셋. **API 가 받는 값 그대로**(`high`·`mid`·`low`)이고 이름은 여기서 푼다.
 * 화면이 영문 코드를 그리면 무슨 뜻인지 배워야 한다.
 */
export const PRIORITY_CHOICES = [
  { value: "high", label: "높음" },
  { value: "mid", label: "보통" },
  { value: "low", label: "낮음" },
] as const;

export const PRIORITY_LABEL: Record<string, string> =
  Object.fromEntries(PRIORITY_CHOICES.map((p) => [p.value, p.label]));

/**
 * 기간 한 줄 — 「시작 ~ 기한」. 둘 다 없으면 `null`(빈 값 표시는 화면이 한다).
 *
 * 한쪽만 있는 것도 그대로 보인다. 「2026-09-01 ~」 는 시작만 정한 상태를
 * 사실대로 말한다 — 없는 쪽을 오늘로 채우면 화면이 없는 값을 지어낸다.
 */
export function periodText(startDate: string | null, dueDate: string | null): string | null {
  if (!startDate && !dueDate) return null;
  return `${startDate ?? "—"} ~ ${dueDate ?? "—"}`;
}

/**
 * 하위 업무는 **여기서 못 만든다.** 상위를 정하는 쪽이 만든다 (§E-37 의 「하위」).
 *
 * 왜 이렇게 두는가: 같은 관계를 양쪽에서 고칠 수 있게 하면 「A 의 하위에서 B 를
 * 떼기」와 「B 의 상위를 비우기」가 각자 다른 길로 같은 일을 하게 되고,
 * 둘 중 하나만 상속 규칙(§A2)을 지나면 값이 갈린다.
 */
export const CHILD_EDIT_WHY =
  "하위 업무는 그 업무의 「상위 업무」 칸에서 정합니다.";

/** 저장할 값이 있는가 — **안 바뀐 값은 안 보낸다.** 보내면 활동 로그가 더러워진다. */
export function changed(before: string | number | null, after: string | number | null): boolean {
  return (before ?? "") !== (after ?? "");
}

/* ══ 저장이 보이게 (MD-P-2026-047 §B) ═══════════════════════════════
 *
 * 칸에서 벗어날 때 저장하는 방식은 그대로 둔다 — 버튼을 만들면 안 누르고 나가서
 * 잃는다. 대신 **저장된 증거가 화면에 상시로 있어야 한다.**
 *
 * 잠깐 떴다 사라지는 표시는 못 보면 없는 것과 같다. 그래서 이 자리는
 * **안 사라진다**: 저장 전에는 안내, 저장 중에는 「저장 중…」, 저장 뒤에는
 * 「마지막 저장 09:42」가 그대로 남는다. 실패하면 사유가 **그 칸 옆에** 선다.
 *
 * 상태가 칸마다 따로인 이유는 §G 다 — **한 번에 하나씩 저장한다.** 하나로
 * 묶으면 다섯 칸 중 어느 것이 거부됐는지 알 수 없다.
 */
export type SaveTone = "hint" | "busy" | "ok" | "err";

export interface SaveState {
  busy: boolean;
  /** 서버가 저장을 확인한 시각(ms). 아직 없으면 null. */
  savedAt: number | null;
  /** 서버가 준 거절 사유. **그대로** 담는다 — 고쳐 적으면 다른 말이 된다. */
  err: string;
}

export const IDLE: SaveState = { busy: false, savedAt: null, err: "" };

/**
 * 시각을 **KST 시:분**으로. 날짜를 자르는 것이 아니라 순간을 찍는 것이지만,
 * 시간대는 여기서도 정하고 본다 — 「09:42」가 기계마다 다르면 증거가 아니다.
 */
export function clockKst(ms: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
}

/** 그 칸 옆에 적을 한 줄. **빈 문자열을 내지 않는다** — 자리가 없어지면 줄이 뛴다. */
export function saveNote(s: SaveState, hint: string): { tone: SaveTone; text: string } {
  if (s.busy) return { tone: "busy", text: "저장 중…" };
  // 실패가 성공보다 먼저다. 「마지막 저장 09:42」 옆에서 조용히 실패하면
  // 사람은 저장된 줄 안다.
  if (s.err) return { tone: "err", text: `저장 안 됨 · ${s.err}` };
  if (s.savedAt !== null) return { tone: "ok", text: `마지막 저장 ${clockKst(s.savedAt)}` };
  return { tone: "hint", text: hint };
}

/**
 * 서버가 저장을 확인한 시각. **응답의 `Date` 머리글**을 쓴다.
 *
 * 브라우저 시계로 찍으면 시계가 틀린 기계에서 「마지막 저장 03:12」가 뜬다 —
 * 증거로 내놓은 숫자가 거짓말을 하는 셈이다. `Date` 는 HTTP 가 늘 붙이는
 * 머리글이라 **API 를 안 고치고** 서버 시각을 받을 수 있다.
 * 없거나 못 읽으면 브라우저 시계로 내려간다 — 시각이 아예 없는 것보다 낫다.
 */
export function stampFrom(dateHeader: string | null): number {
  const ms = dateHeader ? Date.parse(dateHeader) : NaN;
  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * 빈 제목은 API 가 **조용히 무시한다**(§B-1 조사표). 화면만 비면
 * 「화면은 비었는데 저장은 안 됨」이 되고, 새로고침하면 옛 제목이 돌아온다.
 *
 * 그래서 보내기 전에 화면이 **서버 규칙을 그대로 비춘다** — 되돌리고 이유를 적는다.
 * API 는 안 고친다 (047 §B-1).
 */
export const EMPTY_TITLE_WHY = "제목은 비울 수 없습니다";

export function titleReject(next: string): string | null {
  return next.trim() === "" ? EMPTY_TITLE_WHY : null;
}

/** 하위 진행 요약. 하위가 없으면 `null` — 없는 줄을 그리지 않는다. */
export function childSummary(t: Pick<DetailTask, "children">): string | null {
  if (t.children.length === 0) return null;
  const done = t.children.filter((c) => c.status === "done").length;
  return `하위 ${t.children.length}개 중 ${done}개 완료`;
}
