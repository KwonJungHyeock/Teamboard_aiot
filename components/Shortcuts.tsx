"use client";

// 전역 단축키 처리 (MD-P-2026-006 §A) — AppShell에 1개만 마운트된다.
// 브라우저 기본 동작을 가로채는 건 ⌘F 하나뿐이며, 그때도 "⌘⇧F는 브라우저 검색"을 안내한다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openQuickCreate } from "@/lib/quick";
import { closePanel, currentPanel } from "@/lib/side-panel";
import {
  SHORTCUTS, FIND_EVENT, SHORTCUTS_EVENT, REACTION_PICKER_EVENT, READ_LIST_EVENT,
  isMac, isTyping, keyLabel,
} from "@/lib/shortcuts";
import { FIRSTRUN_EVENT } from "./FirstRun";

export default function Shortcuts() {
  const router = useRouter();
  const [listOpen, setListOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [mac, setMac] = useState(false);

  useEffect(() => { setMac(isMac()); }, []);

  const onKey = useCallback((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = isTyping(e.target);
    const k = e.key.toLowerCase();

    // ── 입력 중에도 살아 있는 것: ⌘K · ⌘N ──
    if (mod && !e.shiftKey && k === "k") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("tb:open-palette"));
      return;
    }
    if (mod && !e.shiftKey && k === "n") {
      e.preventDefault();
      openQuickCreate({ x: window.innerWidth / 2 - 160, y: 150 });
      return;
    }

    // Esc는 입력 중에도 통해야 한다(컴포저 취소 → 패널 닫기 순서는 각 컴포넌트가 먼저 처리).
    if (k === "escape") {
      if (typing) return; // 입력 취소는 해당 입력이 처리한다
      if (currentPanel()) { closePanel(); return; }
      // 열린 패널이 없으면 §F대로 현재 목록을 읽음 처리한다
      window.dispatchEvent(new CustomEvent(READ_LIST_EVENT));
      return;
    }

    if (typing) return; // 그 밖의 단축키는 입력 중 비활성

    if (mod && k === "/") { e.preventDefault(); setListOpen((v) => !v); return; }
    if (mod && !e.shiftKey && k === "f") { e.preventDefault(); setFindOpen(true); return; }
    if (mod && e.shiftKey && k === "a") { e.preventDefault(); router.push("/activity"); return; }
    if (mod && e.shiftKey && k === "s") { e.preventDefault(); router.push("/saved"); return; }
    if (mod && e.shiftKey && (k === "\\" || e.code === "Backslash")) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent(REACTION_PICKER_EVENT));
      return;
    }
  }, [router]);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    const openList = () => setListOpen(true);
    const openFind = () => setFindOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, openList);
    window.addEventListener(FIND_EVENT, openFind);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(SHORTCUTS_EVENT, openList);
      window.removeEventListener(FIND_EVENT, openFind);
    };
  }, [onKey]);

  return (
    <>
      {listOpen && <ShortcutList mac={mac} onClose={() => setListOpen(false)} />}
      {findOpen && <FindBar mac={mac} onClose={() => setFindOpen(false)} />}
    </>
  );
}

/** ⌘/ — 모든 단축키를 그룹별로. 레지스트리를 그대로 렌더하므로 숨은 단축키가 없다. */
function ShortcutList({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const groups = Array.from(new Set(SHORTCUTS.map((s) => s.group)));
  return (
    <div className="ovl on" onClick={onClose}>
      <div className="scut" role="dialog" aria-modal="true" aria-label="단축키" onClick={(e) => e.stopPropagation()}>
        <div className="scut-h">
          <b>단축키</b>
          <span className="scut-os num">{mac ? "macOS" : "Windows · Linux"}</span>
          <button className="gpanel-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="scut-b">
          {groups.map((g) => (
            <section key={g}>
              <h4>{g}</h4>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div className="scut-row" key={s.keys.join("+") + s.label}>
                  <kbd className="scut-k">{keyLabel(s.keys, mac)}</kbd>
                  <span>
                    {s.label}
                    {s.noteKeys && <em className="scut-note"> ({s.noteLabel} {keyLabel(s.noteKeys, mac)})</em>}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <p className="scut-foot">
          입력 중에는 {keyLabel(["mod", "K"], mac)}·{keyLabel(["mod", "N"], mac)}만 동작합니다.
          <span className="gsp" style={{ flex: 1 }} />
          {/* 첫 사용 안내로 되돌아가는 통로 (MD-P-2026-015 §A) */}
          <button
            className="lk"
            onClick={() => { onClose(); window.dispatchEvent(new Event(FIRSTRUN_EVENT)); }}
          >
            처음이신가요? 안내 다시 보기
          </button>
        </p>
      </div>
    </div>
  );
}

/** ⌘F — 화면 내 검색. 브라우저 기본 찾기는 ⌘⇧F로 안내한다(가로채는 유일한 기본 동작). */
function FindBar({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(0);
  const [idx, setIdx] = useState(0);
  const ranges = useRef<Range[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // 하이라이트 정리 — 닫힐 때 반드시 지운다(DOM은 건드리지 않는다)
  const clear = useCallback(() => {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    hl?.delete("tb-find");
    ranges.current = [];
  }, []);
  useEffect(() => clear, [clear]);

  const run = useCallback((needle: string) => {
    clear();
    setIdx(0);
    if (!needle.trim()) { setHits(0); return; }
    const root = document.querySelector("main.main") ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest(".find-bar")) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const lower = needle.toLowerCase();
    const found: Range[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = (n.nodeValue ?? "").toLowerCase();
      let from = 0;
      for (;;) {
        const at = text.indexOf(lower, from);
        if (at < 0) break;
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + needle.length);
        found.push(r);
        from = at + needle.length;
        if (found.length > 300) break;
      }
      if (found.length > 300) break;
    }
    ranges.current = found;
    setHits(found.length);
    const api = window as unknown as { Highlight?: new (...r: Range[]) => unknown };
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (api.Highlight && hl && found.length) hl.set("tb-find", new api.Highlight(...found));
    if (found.length) found[0].startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [clear]);

  useEffect(() => { run(q); }, [q, run]);

  function jump(delta: number) {
    if (!ranges.current.length) return;
    const next = (idx + delta + ranges.current.length) % ranges.current.length;
    setIdx(next);
    ranges.current[next].startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <div className="find-bar" role="search" aria-label="화면 내 검색">
      <input
        ref={inputRef}
        value={q}
        placeholder="이 화면에서 찾기"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); clear(); onClose(); }
          if (e.key === "Enter") { e.preventDefault(); jump(e.shiftKey ? -1 : 1); }
        }}
      />
      <span className="find-n num">{hits === 0 ? "0" : `${idx + 1}/${hits}`}</span>
      <button className="find-b" onClick={() => jump(-1)} aria-label="이전">↑</button>
      <button className="find-b" onClick={() => jump(1)} aria-label="다음">↓</button>
      <span className="find-hint">브라우저 검색은 {keyLabel(["mod", "shift", "F"], mac)}</span>
      <button className="find-b" onClick={() => { clear(); onClose(); }} aria-label="닫기">✕</button>
    </div>
  );
}
