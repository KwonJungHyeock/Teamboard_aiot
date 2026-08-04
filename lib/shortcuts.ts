"use client";

// 전역 단축키 레지스트리 (MD-P-2026-006 §A).
// 원칙: 여기 없는 단축키는 존재하지 않는다. ⌘/ 목록은 이 배열을 그대로 렌더하므로
// 숨은 단축키가 생길 수 없다.

export interface Shortcut {
  /** 표기용 키 조합. "mod"는 OS에 따라 ⌘/Ctrl로 치환된다. */
  keys: string[];
  label: string;
  group: string;
  /** 라벨 뒤 괄호에 붙는 보조 키 표기 — OS에 맞춰 치환된다 */
  noteKeys?: string[];
  noteLabel?: string;
  /** 텍스트 입력 중에도 살아 있는 단축키인지 (§A: ⌘K·⌘N만 해당) */
  whileTyping?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ["mod", "K"], label: "빠른 이동 — 프로젝트·업무·사람·결정 통합 검색", group: "이동", whileTyping: true },
  { keys: ["mod", "/"], label: "단축키 목록 열기", group: "이동" },
  { keys: ["mod", "F"], label: "화면 내 검색", group: "이동", noteKeys: ["mod", "shift", "F"], noteLabel: "브라우저 검색은" },
  { keys: ["mod", "shift", "A"], label: "활동", group: "이동" },
  { keys: ["mod", "shift", "S"], label: "저장됨", group: "이동" },
  { keys: ["mod", "N"], label: "새 업무", group: "만들기", whileTyping: true },
  { keys: ["mod", "shift", "\\"], label: "리액션 피커 열기", group: "작성" },
  { keys: ["up"], label: "입력창이 비었을 때 직전 내 코멘트 편집", group: "작성" },
  { keys: ["esc"], label: "패널·모달 닫기 — 열린 게 없으면 목록을 읽음 처리", group: "패널" },
];

/** mac이면 ⌘ 표기, 그 외는 Ctrl. 렌더 시점에만 호출한다(SSR 불일치 방지). */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

const MAC_MAP: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", esc: "Esc", up: "↑", down: "↓" };
const WIN_MAP: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", esc: "Esc", up: "↑", down: "↓" };

/** 키 조합 표기 — OS 감지로 ⌘ ↔ Ctrl 전환. */
export function keyLabel(keys: string[], mac = isMac()): string {
  const map = mac ? MAC_MAP : WIN_MAP;
  return keys.map((k) => map[k] ?? k).join(mac ? "" : "+");
}

/** 지금 포커스가 텍스트 입력 중인가 — 입력 중에는 ⌘K·⌘N 외 단축키를 잠근다. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

// 화면 안에서 여는 UI들 — 컴포넌트 간 결합을 줄이려 이벤트로 통지한다.
export const FIND_EVENT = "tb:find";              // ⌘F 화면 내 검색
export const SHORTCUTS_EVENT = "tb:shortcuts";    // ⌘/ 목록
export const REACTION_PICKER_EVENT = "tb:reaction-picker"; // ⌘⇧\
export const READ_LIST_EVENT = "tb:read-list";    // Esc — 열린 패널이 없을 때
