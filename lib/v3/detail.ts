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
  return "진척은 지정된 한 사람만 손으로 바꿉니다. 이 화면에는 칸이 없습니다.";
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
export type EditField = "title" | "description" | "status" | "assigneeId" | "dueDate";

export function patchBody(field: EditField, value: string | number | null): Record<string, unknown> {
  return { [field]: value };
}

/** 저장할 값이 있는가 — **안 바뀐 값은 안 보낸다.** 보내면 활동 로그가 더러워진다. */
export function changed(before: string | number | null, after: string | number | null): boolean {
  return (before ?? "") !== (after ?? "");
}

/** 하위 진행 요약. 하위가 없으면 `null` — 없는 줄을 그리지 않는다. */
export function childSummary(t: Pick<DetailTask, "children">): string | null {
  if (t.children.length === 0) return null;
  const done = t.children.filter((c) => c.status === "done").length;
  return `하위 ${t.children.length}개 중 ${done}개 완료`;
}
