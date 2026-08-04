"use client";

// hover 액션 바 (MD-P-2026-006 §C) — 리스트 항목·코멘트·업무 카드의 우상단에 뜬다.
// 아이콘 순서는 어디서나 고정: 리액션 · 스레드/답글 · 저장 · ⋯ 더보기.
// 키보드 포커스(:focus-within)에서도 같은 자리에 나타난다 — 마우스 없이도 도달 가능.
import { useEffect, useRef, useState } from "react";
import { REACTION_EMOJIS } from "./collab-ui";
import { toast } from "@/lib/quick";
import { notifySavedChanged } from "@/lib/collab-events";
import { REACTION_PICKER_EVENT } from "@/lib/shortcuts";

export type SaveType = "task" | "signal" | "decision" | "project";
export interface MoreItem { label: string; onClick: () => void; danger?: boolean }

export default function HoverActions({
  reactionTarget, threadLabel = "스레드", onThread, saveType, saveId, saved, onSavedChange, more = [],
}: {
  /** 리액션 대상 — 없으면 리액션 버튼을 숨긴다(자리는 접힌다). */
  reactionTarget?: { type: "reply" | "signal" | "task" | "activity"; id: number };
  threadLabel?: string;
  onThread?: () => void;
  saveType?: SaveType;
  saveId?: number;
  saved?: boolean;
  onSavedChange?: (next: boolean) => void;
  more?: MoreItem[];
}) {
  const [pick, setPick] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(!!saved);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { setOn(!!saved); }, [saved]);

  // ⌘⇧\ — 포커스가 이 항목 안에 있을 때만 리액션 피커를 연다
  useEffect(() => {
    if (!reactionTarget) return;
    const open = () => {
      const el = wrap.current?.closest(".ha-host");
      if (el && el.contains(document.activeElement)) setPick(true);
    };
    window.addEventListener(REACTION_PICKER_EVENT, open);
    return () => window.removeEventListener(REACTION_PICKER_EVENT, open);
  }, [reactionTarget]);

  // 바깥 클릭으로 팝오버 닫기
  useEffect(() => {
    if (!pick && !menu) return;
    const off = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) { setPick(false); setMenu(false); }
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [pick, menu]);

  async function react(emoji: string) {
    if (!reactionTarget || busy) return;
    setBusy(true);
    setPick(false);
    const res = await fetch("/api/reactions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: reactionTarget.type, targetId: reactionTarget.id, emoji }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { toast("리액션에 실패했어요", "err"); return; }
    window.dispatchEvent(new CustomEvent("tb:reaction-changed", { detail: reactionTarget }));
  }

  async function toggleSave() {
    if (!saveType || !saveId || busy) return;
    const next = !on;
    setOn(next); // 낙관적 반영 — 실패 시 되돌린다
    setBusy(true);
    const res = await fetch("/api/saved", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: saveType, targetId: saveId, saved: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setOn(!next); toast("저장에 실패했어요", "err"); return; }
    onSavedChange?.(next);
    notifySavedChanged();
    toast(next ? "저장됨에 담았어요" : "저장을 해제했어요");
  }

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className="ha" ref={wrap} onClick={stop}>
      {reactionTarget && (
        <div className="ha-wrap">
          <button className="ha-b" aria-label="리액션" title="리액션" aria-expanded={pick}
            onClick={(e) => { stop(e); setPick((v) => !v); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></svg>
          </button>
          {pick && (
            <div className="ha-pick" role="menu" aria-label="이모지 선택">
              {REACTION_EMOJIS.map((e) => (
                <button key={e} onClick={(ev) => { stop(ev); react(e); }} aria-label={e}>{e}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {onThread && (
        <button className="ha-b" aria-label={threadLabel} title={threadLabel}
          onClick={(e) => { stop(e); onThread(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-4.5A8 8 0 1 1 21 12Z" /></svg>
        </button>
      )}

      {saveType && saveId != null && (
        <button className={`ha-b${on ? " on" : ""}`} aria-label={on ? "저장 해제" : "저장"} title={on ? "저장 해제" : "저장"}
          aria-pressed={on} onClick={(e) => { stop(e); toggleSave(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill={on ? "currentColor" : "none"}>
            <path d="M6 3h12v18l-6-4.5L6 21V3Z" />
          </svg>
        </button>
      )}

      {more.length > 0 && (
        <div className="ha-wrap">
          <button className="ha-b" aria-label="더보기" title="더보기" aria-expanded={menu}
            onClick={(e) => { stop(e); setMenu((v) => !v); }}>⋯</button>
          {menu && (
            <div className="ha-menu" role="menu">
              {more.map((m) => (
                <button key={m.label} className={m.danger ? "danger" : ""}
                  onClick={(e) => { stop(e); setMenu(false); m.onClick(); }}>{m.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
