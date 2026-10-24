"use client";

// 공통 부품 — 세그먼트 · 체크박스 · 상태 점 · 배지 · 드로어 · 팝오버 · 토스트 (DESIGN.md 3.5).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Look } from "@/lib/ed/core";

export function Seg<T extends string>({ value, options, onChange, full, className }: {
  value: T; options: { v: T; label: React.ReactNode; n?: number }[]; onChange: (v: T) => void; full?: boolean; className?: string;
}) {
  return (
    <div className={`ed-seg${full ? " full" : ""}${className ? ` ${className}` : ""}`} role="tablist">
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={o.v === value} className={o.v === value ? "on" : undefined} onClick={() => onChange(o.v)}>
          {o.label}{o.n !== undefined && <small>{o.n}</small>}
        </button>
      ))}
    </div>
  );
}

export function Check({ on, onClick, tone = "green", size, label }: { on: boolean; onClick?: () => void; tone?: "green" | "accent"; size?: "sm"; label?: string }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label ?? (on ? "완료 취소" : "완료")}
            className={`ed-check${on ? (tone === "accent" ? " sel" : " on") : ""}${size ? ` ${size}` : ""}`}
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}>{on ? "✓" : ""}</button>
  );
}

export function Dot({ look, halo, className, style }: { look: Look; halo?: boolean; className?: string; style?: React.CSSProperties }) {
  return <span className={`ed-dot s-${look}${halo ? " halo" : ""}${className ? ` ${className}` : ""}`} style={style} aria-hidden="true" />;
}

export function Badge({ tone = "", children, sm }: { tone?: "" | "red" | "amber" | "accent" | "green" | "violet"; children: React.ReactNode; sm?: boolean }) {
  return <span className={`ed-badge${tone ? ` ${tone}` : ""}${sm ? " sm" : ""}`}>{children}</span>;
}

/** 오른쪽 드로어 — scrim + blur, Esc · 바깥 클릭으로 닫힌다 */
export function Drawer({ onClose, width = 460, children, label }: { onClose: () => void; width?: number; children: React.ReactNode; label?: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!host) return null;
  return createPortal(
    <>
      <div className="ed-scrim" onClick={onClose} />
      <aside className="ed-drawer" style={{ width }} role="dialog" aria-modal="true" aria-label={label}>{children}</aside>
    </>, host);
}

/** 바깥을 누르거나 Esc 면 닫히는 팝오버 상태 */
export function usePop<K extends string>(): [K | null, (k: K | null) => void, React.RefObject<HTMLDivElement>] {
  const [open, setOpen] = useState<K | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return [open, setOpen, ref];
}

/** 한 번 뜨는 알림 줄(되돌리기 등) */
export function useToast(): [React.ReactNode, (text: string, action?: { label: string; run: () => void }) => void] {
  const [t, setT] = useState<{ text: string; action?: { label: string; run: () => void }; k: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((text: string, action?: { label: string; run: () => void }) => {
    clearTimeout(timer.current);
    setT({ text, action, k: Date.now() });
    timer.current = setTimeout(() => setT(null), 4200);
  }, []);
  const node = t ? (
    <div className="ed-toast" key={t.k} role="status">
      {t.text}
      {t.action && <button type="button" onClick={() => { t.action!.run(); setT(null); }}>{t.action.label}</button>}
    </div>
  ) : null;
  return [node, show];
}

/** 같은 애니메이션을 다시 돌릴 때 A/B 이름을 번갈아 준다 */
export function useFlip(): [string, () => void] {
  const [n, setN] = useState(0);
  return [n % 2 ? "B" : "A", useCallback(() => setN((x) => x + 1), [])];
}

/** 모든 화면이 쓰는 「데이터가 바뀌었다」 신호 — 드로어에서 고치면 목록이 다시 읽는다 */
export function emitChanged() { window.dispatchEvent(new Event("ed:changed")); }
export function useOnChanged(fn: () => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener("ed:changed", h);
    return () => window.removeEventListener("ed:changed", h);
  }, []);
}

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(url, {
    method: init?.method ?? "GET", cache: "no-store",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? `요청 실패 (${r.status})`);
  return d as T;
}
