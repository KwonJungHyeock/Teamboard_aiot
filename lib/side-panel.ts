"use client";

// 전역 우측 패널 (MD-P-2026-006 §B) — 업무·논의·멤버·결정을 한 컴포넌트에서 연다.
// 규칙: 폭 420px · Esc 닫기 · 좌측 목록 계속 조작 · 스택 깊이 1(교체, 중첩 금지) · URL 반영(공유 가능).
export const SIDE_PANEL_EVENT = "tb:side-panel";

export type PanelKind = "task" | "signal" | "member" | "decision";
export interface PanelRef { kind: PanelKind; id: number }

const KINDS: PanelKind[] = ["task", "signal", "member", "decision"];

/** URL ?panel=kind:id → PanelRef. 레거시 ?task=·?signal= 도 해석한다. */
export function currentPanel(): PanelRef | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get("panel");
  if (raw) {
    const [kind, idStr] = raw.split(":");
    const id = Number(idStr);
    if ((KINDS as string[]).includes(kind) && Number.isInteger(id) && id > 0) {
      return { kind: kind as PanelKind, id };
    }
  }
  // 레거시 파라미터 호환 (기존 링크·북마크가 계속 동작)
  for (const legacy of [["task", "task"], ["signal", "signal"]] as const) {
    const v = Number(sp.get(legacy[0]));
    if (Number.isInteger(v) && v > 0) return { kind: legacy[1] as PanelKind, id: v };
  }
  return null;
}

/** 패널 열기 — 스택 깊이 1이므로 항상 "교체"다. */
export function openPanel(kind: PanelKind, id: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("panel", `${kind}:${id}`);
  // 레거시 파라미터는 정리해 상태가 두 곳에 남지 않게 한다
  url.searchParams.delete("task");
  url.searchParams.delete("signal");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(SIDE_PANEL_EVENT, { detail: { kind, id } }));
}

export function closePanel() {
  const url = new URL(window.location.href);
  url.searchParams.delete("panel");
  url.searchParams.delete("task");
  url.searchParams.delete("signal");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(SIDE_PANEL_EVENT, { detail: null }));
}

export const openTaskPanelG = (id: number) => openPanel("task", id);
export const openSignalPanel = (id: number) => openPanel("signal", id);
export const openMemberPanel = (id: number) => openPanel("member", id);
export const openDecisionPanel = (id: number) => openPanel("decision", id);
