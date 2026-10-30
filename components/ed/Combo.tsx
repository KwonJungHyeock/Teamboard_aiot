"use client";

// 고르거나 적기 — 카테고리 · 목표처럼 「있는 것에서 고르거나, 없으면 바로 만든다」.
//   누르면 목록, 글자를 치면 걸러지고, 없는 이름이면 맨 아래 「+ 만들기」. ↑↓ · Enter · Esc.
//   지울 수 있는 항목은 줄 끝에 ✕(onRemove) — 정리도 여기서.
import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboOpt { id: number; label: string; dot?: string; removable?: boolean }

export default function Combo({ value, options, onPick, onCreate, onRemove, none, placeholder, disabled, label }: {
  value: number | null; options: ComboOpt[]; onPick: (id: number | null) => void;
  onCreate?: (text: string) => Promise<void> | void; onRemove?: (o: ComboOpt) => void;
  /** 「없음」 줄의 이름. 비우면 없음을 고를 수 없다 */
  none?: string; placeholder?: string; disabled?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [hi, setHi] = useState(0);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cur = options.find((o) => o.id === value) ?? null;

  const q = text.trim().toLowerCase();
  const shown = useMemo(() => options.filter((o) => !q || o.label.toLowerCase().includes(q)), [options, q]);
  const canMake = !!onCreate && !!q && !options.some((o) => o.label.toLowerCase() === q);
  // 줄: [없음] + 걸러진 것 + [만들기]
  const rows: ({ k: "none" } | { k: "opt"; o: ComboOpt } | { k: "make" })[] = [
    ...(none && !q ? [{ k: "none" as const }] : []),
    ...shown.map((o) => ({ k: "opt" as const, o })),
    ...(canMake ? [{ k: "make" as const }] : []),
  ];

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);
  useEffect(() => { setHi(0); }, [q, open]);

  const close = () => { setOpen(false); setText(""); };
  const choose = async (r: (typeof rows)[number] | undefined) => {
    if (!r || busy) return;
    if (r.k === "none") onPick(null);
    else if (r.k === "opt") onPick(r.o.id);
    else if (onCreate) { setBusy(true); try { await onCreate(text.trim()); } finally { setBusy(false); } }
    close(); input.current?.blur();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (open) void choose(rows[hi]); else setOpen(true); }
    else if (e.key === "Escape" && open) { e.preventDefault(); close(); }
  };

  return (
    <div className={`cb${open ? " open" : ""}`} ref={box}>
      {cur?.dot && !open && <i className="cb-dot" style={{ background: cur.dot }} />}
      <input ref={input} className={`ed-input cb-in${cur?.dot && !open ? " dot" : ""}`} disabled={disabled || busy} aria-label={label}
             role="combobox" aria-expanded={open} aria-autocomplete="list"
             value={open ? text : cur?.label ?? ""} placeholder={open ? (onCreate ? "찾거나 새로 적기" : "찾기") : (cur ? "" : none ?? placeholder ?? "")}
             onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(e) => { setText(e.target.value); setOpen(true); }} onKeyDown={onKey} />
      <span className="cb-cv" aria-hidden="true">▾</span>
      {open && (
        <div className="cb-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {rows.length === 0 && <div className="cb-empty">없음</div>}
          {rows.map((r, i) => (
            <div key={r.k === "opt" ? r.o.id : r.k} role="option" aria-selected={i === hi}
                 className={`cb-row${i === hi ? " hi" : ""}${r.k === "make" ? " make" : ""}${(r.k === "opt" && r.o.id === value) || (r.k === "none" && value === null) ? " on" : ""}`}
                 onMouseEnter={() => setHi(i)} onClick={() => void choose(r)}>
              {r.k === "none" && <span className="cb-t">{none}</span>}
              {r.k === "make" && <span className="cb-t">+ 「{text.trim()}」 만들기</span>}
              {r.k === "opt" && <>
                {r.o.dot && <i className="cb-dot in" style={{ background: r.o.dot }} />}
                <span className="cb-t">{r.o.label}</span>
                {onRemove && r.o.removable && (
                  <button type="button" className="cb-rm" aria-label={`${r.o.label} 지우기`} title="지우기"
                          onClick={(e) => { e.stopPropagation(); close(); onRemove(r.o); }}>✕</button>
                )}
              </>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
