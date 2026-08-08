"use client";

// 수동 스냅샷 + 실행 이력 (MD-P-2026-011 §D·F) — 목표 페이지 우상단 ⋯ 메뉴. 팀장 전용.
// 같은 날 다시 실행하면 덮어쓴다(upsert) — 행이 늘지 않는다.
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/quick";
import SectionEmpty from "./SectionEmpty";

interface RunRow {
  id: number; run_date: string; source: string; ok: boolean;
  goal_count: number; duration_ms: number; error: string | null; created_at: string;
}

export default function SnapshotMenu({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  async function saveNow() {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/cron/goal-snapshot", { method: "POST" }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) { toast(d?.error ?? "스냅샷 저장에 실패했어요", "err"); return; }
    toast(`${d.date} 스냅샷 저장 — 목표 ${d.goalCount}건 (${d.durationMs}ms)`);
    setOpen(false);
    setRuns(null);
    onSaved?.();
  }

  async function loadRuns() {
    const res = await fetch("/api/cron/goal-snapshot", { method: "PATCH" }).catch(() => null);
    if (!res || !res.ok) { toast("이력을 불러오지 못했어요", "err"); return; }
    setRuns((await res.json()).runs ?? []);
  }

  return (
    <div className="snapm" ref={wrap}>
      <button className="pws-more" aria-label="스냅샷 메뉴" aria-expanded={open} onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <div className="snapm-menu" role="menu">
          <button onClick={saveNow} disabled={busy}>
            {busy ? "저장 중…" : "지금 스냅샷 저장"}
          </button>
          <button onClick={() => (runs ? setRuns(null) : loadRuns())}>
            {runs ? "적립 이력 닫기" : "적립 이력 보기"}
          </button>
          <p className="snapm-note">매일 00:10(KST) 자동 적립됩니다. 같은 날 저장하면 덮어씁니다.</p>

          {runs && (
            <div className="snapm-runs">
              {runs.length === 0 && <SectionEmpty text="기록된 실행이 없어요" />}
              {runs.map((r) => (
                <div className={`snapm-run${r.ok ? "" : " bad"}`} key={r.id}>
                  <span className={`snapm-led ${r.ok ? "ok" : "bad"}`} aria-hidden="true" />
                  <span className="num">{r.run_date}</span>
                  <span className="snapm-src">{r.source === "manual" ? "수동" : "자동"}</span>
                  <span className="gsp" style={{ flex: 1 }} />
                  <span className="num">{r.ok ? `${r.goal_count}건 · ${r.duration_ms}ms` : (r.error ?? "실패").slice(0, 24)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
