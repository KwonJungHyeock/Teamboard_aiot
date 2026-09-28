// 줄에서 바로 끝내기 — **규칙만** 모은 곳 (MD-P-2026-070 §A · §B · §C · §F).
//
// 화면 부품(`components/v3/Live.tsx`)은 이 파일을 부른다. 규칙을 부품 안에 두면
// 검사기가 같은 함수를 못 불러서 「화면이 자기가 그린 것을 그렸다」밖에 못 잰다
// (043 부터의 방식). **이 파일은 순수하다** — `fetch` 도 DOM 도 없다.
import { STATUS_META } from "../task-view";
import { canEditProgress } from "../progress-permission";

/* ══ §A-1 토스트 ═══════════════════════════════════════════════════ */

/** 되돌릴 수 있는 동작의 토스트가 머무는 시간 (§A-1-2). */
export const TOAST_UNDO_MS = 5000;
/** 되돌릴 수 없는 동작 — 버튼 없이 이만큼 (§A-1-2). */
export const TOAST_PLAIN_MS = 2600;

/** 버튼이 있으면 5초, 없으면 2.6초. 「다시」도 누를 거리이므로 5초다. */
export function toastMs(hasButton: boolean): number {
  return hasButton ? TOAST_UNDO_MS : TOAST_PLAIN_MS;
}

/* ══ §B-2 상태 고르개 ══════════════════════════════════════════════ */

/**
 * 고르개의 네 줄. **낱말은 여기 적지 않는다** — `STATUS_META` 에서 가져온다
 * (071 §A · 065 §A-2). 070 에서는 지시서 낱말(미착수 · 검토)을 여기 따로 적었고,
 * 그래서 이 화면만 다른 화면들(대기 · 리뷰)과 낱말 둘이 갈렸다.
 *
 * 한 낱말인 것이 어느 낱말인가보다 중요하다(071 §A-5). 여기 남는 것은 **차례**뿐이다.
 * 칩에 적히는 글자도 이 표에서 온다 — 칩과 고르개가 다른 말을 하면 안 된다.
 */
const PICK_KEYS = ["todo", "doing", "review", "done"] as const;
export type PickStatus = (typeof PICK_KEYS)[number];
export const STATUS_PICK: readonly { key: PickStatus; label: string }[] =
  PICK_KEYS.map((key) => ({ key, label: STATUS_META[key].label }));

export function pickLabel(status: string): string {
  // 제안 · 중단처럼 고르개에 없는 상태도 **같은 표**의 낱말로 그린다
  return STATUS_META[status]?.label ?? status;
}
export function isPickStatus(s: string): s is PickStatus {
  return STATUS_PICK.some((p) => p.key === s);
}

/** §B-1 — 체크: 완료가 아니면 완료로, 완료면 미착수로. */
export function toggled(status: string): PickStatus {
  return status === "done" ? "todo" : "done";
}

/* ══ §A-1-4 문구 — **무엇이 어떻게 됐는지** 한 줄 ══════════════════ */

/** 제목이 길면 줄인다. 토스트는 한 줄이다. */
export function clip(title: string, max = 18): string {
  const t = title.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 「**완료**로 바꿨습니다 · 통합SDK 라이브러리…」 — 굵게 쓸 낱말을 따로 돌려준다. */
export function changedLine(status: string, title: string): { strong: string; rest: string } {
  const w = pickLabel(status);
  return { strong: w, rest: `${josaRo(w)} 바꿨습니다 · ${clip(title)}` };
}
/** 되돌린 뒤의 한 줄. 되돌린 것은 다시 되돌리지 않는다 — 버튼 없이 2.6초. */
export function undoneLine(status: string, title: string): { strong: string; rest: string } {
  const w = pickLabel(status);
  return { strong: w, rest: `${josaRo(w)} 되돌렸습니다 · ${clip(title)}` };
}
/** §A-2-6 — 실패. 「저장하지 못했습니다 · 다시」 의 앞부분. 버튼이 「다시」다. */
export const FAIL_LINE = "저장하지 못했습니다";

/* ══ 073 §A — 되돌리기가 진행률도 되돌린다 ══════════════════════════ */

/**
 * 진행률 권한이 없어 **상태만** 되돌렸을 때의 한 줄(073 §A-6 문구 그대로).
 * 조용히 두지 않는다 — 「조용히 되돌리지 않는다」(070 §G)가 그대로 걸린다.
 */
export const PROGRESS_KEPT_LINE = "상태는 되돌렸습니다. 진행률은 그대로입니다";

/**
 * 이 동작을 되돌릴 때 **다시 보내야 할 진행률.** 없으면 `null`.
 *
 * 완료로 바꾸면 서버가 진행률을 100 으로 올린다(`nextProgress = 100`). 상태만 되돌리면
 * 진행률은 100 에 남고, 그 값이 목표 진척으로 올라간다 — 보고 숫자가 틀린다(073 §A-4).
 *
 *   · 완료로 가는 동작일 때만 — 다른 전이는 진행률을 안 건드린다
 *   · 하위로 계산되는 업무는 빼다 — 손 값이 안 쓰이므로 되돌릴 것이 없다
 *   · 원래 100 이었으면 뺀다 — 되돌릴 차이가 없다
 *
 * `progress` 는 `/api/tasks` 의 **실효 진척**이다. 하위가 없고 완료가 아니면 저장값과 같다
 * (`taskProgress`) — 그래서 70% 였으면 70 을 돌려준다. 0 이 아니다(073 §A-10).
 */
export function progressToRestore(
  t: { status: string; progress?: number; childCounted?: number | null }, next: string,
): number | null {
  if (next !== "done" || t.status === "done") return null;
  if ((t.childCounted ?? 0) > 0) return null;
  if (typeof t.progress !== "number" || t.progress === 100) return null;
  return t.progress;
}

/**
 * 이 사람이 진행률을 되돌릴 수 있는가 — **서버와 같은 함수**(`canEditProgress`)에게 묻는다.
 * 하위가 없는 업무만 여기 오므로 하위 수는 0 이다. 편집자를 모르면(`null`) 없는 것으로 본다.
 */
export function canRestoreProgress(viewerId: number, editorId: number | null): boolean {
  return canEditProgress(viewerId, editorId, { childCount: 0 }).canEdit;
}

/** 받침이 있으면 「으로」, 없거나 ㄹ 받침이면 「로」. */
export function josaRo(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return "로";
  const jong = (c - 0xac00) % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/* ══ §B-3 · §D-39 — 아직 안 여는 자리 ══════════════════════════════ */

/** 눌렀는데 아무 일도 안 일어나는 자리를 만들지 않는다(§B-20). 이 말을 띄운다. */
export function nextTimeLine(what: string): string {
  return `${what} — 다음 회차에 엽니다`;
}

/* ══ §C 키보드 ═════════════════════════════════════════════════════ */

/** 화면 머리 아래 적어 두는 단축키(§C-28). **여기 없는 단축키는 없는 것과 같다.** */
export const SHORTCUTS = [
  { keys: ["J", "K"], label: "줄 이동" },
  { keys: ["X"], label: "완료" },
  { keys: ["E"], label: "상태" },
  { keys: ["C"], label: "새 업무" },
  { keys: ["⌘K"], label: "찾기" },
] as const;

/**
 * 키 하나를 동작으로 푼다. 입력칸 안이면 J·K·X·E·C 는 **글자다**(§C-26) —
 * ⌘K 와 Esc 만 어디서나 듣는다. 한글 자판도 같은 자리를 받는다(ㅓ·ㅏ·ㅌ·ㄷ·ㅊ).
 */
export type KeyAct = "next" | "prev" | "toggle" | "status" | "new" | "find" | "close" | null;
export function keyAct(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
                       typing: boolean): KeyAct {
  const k = e.key;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === "k" || k === "K" || k === "ㅏ")) return "find";
  if (k === "Escape") return "close";
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (k) {
    case "j": case "J": case "ㅓ": return "next";
    case "k": case "K": case "ㅏ": return "prev";
    case "x": case "X": case "ㅌ": return "toggle";
    case "e": case "E": case "ㄷ": return "status";
    case "c": case "C": case "ㅊ": return "new";
    default: return null;
  }
}

/** 고른 줄을 옮긴다. 아무것도 안 골랐으면 J 는 첫 줄, K 는 끝 줄. 끝에서 멈춘다. */
export function moveSel(cur: number, n: number, dir: 1 | -1): number {
  if (n <= 0) return -1;
  if (cur < 0) return dir === 1 ? 0 : n - 1;
  return Math.min(n - 1, Math.max(0, cur + dir));
}

/* ══ §D 찾기 ═══════════════════════════════════════════════════════ */

export interface FindItem {
  group: "업무" | "목표" | "화면" | "동작";
  id: string;
  label: string;
  /** 새 업무 만들기 줄 — 찾는 게 없을 때 맨 위에 선다(§D-35) */
  create?: boolean;
}
export const FIND_GROUPS: FindItem["group"][] = ["업무", "목표", "화면", "동작"];

/** 대소문자·띄어쓰기를 가리지 않고 들어 있으면 맞는 것이다. */
function hits(label: string, q: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return n(label).includes(n(q));
}

/**
 * 한 칸에서 넷을 찾는다(§D-33). 묶음 차례는 `FIND_GROUPS` 그대로다.
 * 친 글자가 있는데 **맞는 것이 하나도 없으면** 「‘q’로 새 업무 만들기」 한 줄이
 * 맨 위에 선다(§D-35). 빈 칸이면 전부 내놓되 묶음마다 다섯까지.
 */
export function findItems(all: FindItem[], q: string, perGroup = 5): FindItem[] {
  const query = q.trim();
  const out: FindItem[] = [];
  for (const g of FIND_GROUPS) {
    const inG = all.filter((i) => i.group === g && (!query || hits(i.label, query)));
    out.push(...inG.slice(0, perGroup));
  }
  if (query && out.length === 0) {
    out.unshift({ group: "동작", id: "create", label: `‘${query}’로 새 업무 만들기`, create: true });
  }
  return out;
}
