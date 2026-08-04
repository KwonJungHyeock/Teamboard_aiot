"use client";

// 자동완성 트리거 (MD-P-2026-006 §D) — @사람 · :이모지 · #프로젝트.
// 컴포저·코멘트·캔버스 텍스트 블록이 모두 이 훅 하나를 쓴다. "한 곳만 되는 상태"가 생기지 않도록
// 데이터 조회(사람·프로젝트)도 여기서 한 번만 하고 모듈 캐시로 공유한다.
// 조작: ↑↓ 이동 · Enter 선택 · Esc 취소 · 2글자부터 필터링.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface AcItem { id: string; label: string; hint?: string; insert: string }

const EMOJI: { name: string; ch: string }[] = [
  { name: "thumbsup", ch: "👍" }, { name: "tada", ch: "🎉" }, { name: "eyes", ch: "👀" },
  { name: "heart", ch: "❤️" }, { name: "raised_hands", ch: "🙌" }, { name: "thinking", ch: "🤔" },
  { name: "white_check_mark", ch: "✅" }, { name: "fire", ch: "🔥" }, { name: "rocket", ch: "🚀" },
  { name: "warning", ch: "⚠️" }, { name: "bug", ch: "🐛" }, { name: "memo", ch: "📝" },
  { name: "clock", ch: "⏰" }, { name: "bulb", ch: "💡" }, { name: "pray", ch: "🙏" },
];

// 모듈 캐시 — 화면마다 셀렉터를 다시 받지 않는다.
let cache: { people: AcItem[]; projects: AcItem[] } | null = null;
let inflight: Promise<void> | null = null;

async function loadSources() {
  if (cache) return;
  if (!inflight) {
    inflight = fetch("/api/meta/selectors")
      .then((r) => r.json())
      .then((d) => {
        cache = {
          people: (d.actors ?? []).map((a: { id: number; name: string }) => ({
            id: `p${a.id}`, label: a.name, insert: `@${a.name} `,
          })),
          projects: (d.projects ?? []).map((p: { id: number; name: string }) => ({
            id: `j${p.id}`, label: p.name, insert: `#${p.name} `,
          })),
        };
      })
      .catch(() => { cache = { people: [], projects: [] }; })
      .finally(() => { inflight = null; });
  }
  await inflight;
}

type Trigger = "@" | ":" | "#";
interface Query { trigger: Trigger; start: number; text: string }

/** 캐럿 직전의 트리거 토큰을 찾는다. 공백이 끼면 무효. */
function detect(value: string, caret: number): Query | null {
  const upto = value.slice(0, caret);
  let best: Query | null = null;
  for (const trigger of ["@", ":", "#"] as Trigger[]) {
    const at = upto.lastIndexOf(trigger);
    if (at < 0) continue;
    const between = upto.slice(at + 1);
    if (/\s/.test(between)) continue;
    // 트리거 앞은 줄머리이거나 공백이어야 한다 (이메일·시각 표기 오탐 방지)
    const prev = at > 0 ? upto[at - 1] : " ";
    if (!/\s/.test(prev)) continue;
    if (!best || at > best.start) best = { trigger, start: at, text: between };
  }
  return best;
}

export function useAutocomplete(
  value: string,
  onChange: (next: string) => void,
  elRef: { current: HTMLTextAreaElement | HTMLInputElement | null }
) {
  const [q, setQ] = useState<Query | null>(null);
  const [sel, setSel] = useState(0);
  const [, force] = useState(0);
  const armed = useRef(true); // Esc로 끈 뒤에는 같은 토큰에서 다시 뜨지 않는다

  useEffect(() => { loadSources().then(() => force((n) => n + 1)); }, []);

  const items: AcItem[] = useMemo(() => {
    if (!q) return [];
    const needle = q.text.toLowerCase();
    const filter = (list: AcItem[]) =>
      // 2글자부터 필터링 — 그 전에는 전체 목록을 보여준다
      (needle.length >= 2 ? list.filter((i) => i.label.toLowerCase().includes(needle)) : list).slice(0, 8);
    if (q.trigger === "@") return filter(cache?.people ?? []);
    if (q.trigger === "#") return filter(cache?.projects ?? []);
    return (needle.length >= 2
      ? EMOJI.filter((e) => e.name.includes(needle))
      : EMOJI
    ).slice(0, 8).map((e) => ({ id: e.name, label: `${e.ch} :${e.name}:`, insert: `${e.ch} ` }));
  }, [q]);

  const open = !!q && armed.current && items.length > 0;

  /** 입력·클릭 후 캐럿 기준으로 트리거를 다시 계산한다. */
  const sync = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const next = detect(el.value, caret);
    setQ((cur) => {
      if (!next) { armed.current = true; return null; }
      if (!cur || cur.start !== next.start || cur.trigger !== next.trigger) armed.current = true;
      return next;
    });
    setSel(0);
  }, [elRef]);

  const choose = useCallback((item: AcItem) => {
    if (!q) return;
    const before = value.slice(0, q.start);
    const after = value.slice(q.start + 1 + q.text.length);
    onChange(before + item.insert + after);
    setQ(null);
    const caret = (before + item.insert).length;
    setTimeout(() => {
      const el = elRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    }, 0);
  }, [q, value, onChange, elRef]);

  /** 컴포넌트의 onKeyDown 앞단에 끼운다. true를 돌려주면 자동완성이 키를 소비한 것. */
  const onKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => (v + 1) % items.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => (v - 1 + items.length) % items.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(items[sel]); return true; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); armed.current = false; force((n) => n + 1); return true; }
    return false;
  }, [open, items, sel, choose]);

  const menu = open ? (
    <div className="acm" role="listbox" aria-label="자동완성">
      {items.map((it, i) => (
        <button key={it.id} role="option" aria-selected={i === sel} className={i === sel ? "sel" : ""}
          onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); choose(it); }}>
          <span>{it.label}</span>
          {it.hint && <em>{it.hint}</em>}
        </button>
      ))}
    </div>
  ) : null;

  return { menu, onKeyDown, sync, open };
}
