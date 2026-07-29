"use client";

// 빠른 생성 팝오버 (공유 컴포넌트) — 4개 진입점이 같은 폼을 띄운다.
// 필드: 제목·날짜·담당·영역 (+접이식: 프로젝트·우선순위). 저장 즉시 task 생성 → 전역 반영 + 토스트.
import { useCallback, useEffect, useRef, useState } from "react";
import { QUICK_CREATE_EVENT, toast, type QuickAnchor, type QuickPrefill } from "@/lib/quick";
import { notifyTaskUpdated } from "@/lib/task-panel";

interface Sel {
  actors: { id: number; name: string }[];
  projects: { id: number; name: string; areaId: number }[];
  areas: { id: number; name: string; colorKey: string | null }[];
}
const PRIORITY = [["high", "높음"], ["mid", "보통"], ["low", "낮음"]] as const;

const POP_W = 320;
function clampPos(a: QuickAnchor): { left: number; top: number } {
  if (typeof window === "undefined") return { left: a.x, top: a.y };
  const left = Math.min(Math.max(12, a.x), window.innerWidth - POP_W - 12);
  const top = Math.min(Math.max(12, a.y), window.innerHeight - 360);
  return { left, top };
}

export default function QuickCreate() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [sel, setSel] = useState<Sel | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<number | 0>(0);
  const [areaId, setAreaId] = useState<number | 0>(0);
  const [projectId, setProjectId] = useState<number | 0>(0);
  const [priority, setPriority] = useState("mid");
  const [status, setStatus] = useState("todo"); // 보드 상태 컬럼 프리셋(비노출 캐리)
  const ref = useRef<HTMLDivElement>(null);

  const reset = useCallback((p: QuickPrefill) => {
    setTitle(""); setErr(""); setMore(false); setBusy(false);
    setDueDate(p.dueDate ?? "");
    setAssigneeId(p.assigneeId ?? 0);
    setAreaId(p.areaId ?? 0);
    setProjectId(0); setPriority("mid");
    setStatus(p.status ?? "todo");
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail as { anchor: QuickAnchor; prefill: QuickPrefill };
      if (!sel) fetch("/api/meta/selectors").then((r) => r.json()).then(setSel).catch(() => {});
      reset(d.prefill ?? {});
      setPos(clampPos(d.anchor));
      setOpen(true);
    };
    window.addEventListener(QUICK_CREATE_EVENT, onOpen);
    return () => window.removeEventListener(QUICK_CREATE_EVENT, onOpen);
  }, [sel, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [open]);

  // 영역 기본값 — 도착한 selectors 첫 영역
  useEffect(() => {
    if (open && sel && !areaId && sel.areas[0]) setAreaId(sel.areas[0].id);
  }, [open, sel, areaId]);

  async function save() {
    if (busy) return; // 중복 제출 방지(Enter 연타·더블클릭)
    if (!title.trim()) { setErr("제목을 입력하세요."); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          areaId: areaId || undefined,
          projectId: projectId || undefined,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate || undefined,
          priority,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "생성 실패"); setBusy(false); return; }
      setOpen(false);
      // 단일 흐름 — 화면 이동 없이 즉시 전역 연동 + 토스트만. 상세로 튀지 않는다.
      notifyTaskUpdated();
      toast("업무가 생성됐어요");
    } catch {
      setErr("네트워크 오류로 생성하지 못했어요."); setBusy(false);
    }
  }

  if (!open) return null;
  const areaProjects = sel?.projects.filter((p) => p.areaId === areaId) ?? [];

  return (
    <div className="qc" ref={ref} style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="빠른 업무 생성">
      <div className="qc-h"><b>빠른 업무 생성</b><button className="qc-x" onClick={() => setOpen(false)} aria-label="닫기">✕</button></div>
      {err && <p className="qc-err">{err}</p>}
      <input
        className="qc-title" autoFocus placeholder="무엇을 할까요?"
        value={title} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
      />
      <div className="qc-row">
        <label>날짜<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        <label>담당
          <select value={assigneeId} onChange={(e) => setAssigneeId(Number(e.target.value))}>
            <option value={0}>미지정</option>
            {sel?.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <label className="qc-f">영역
        <select value={areaId} onChange={(e) => { setAreaId(Number(e.target.value)); setProjectId(0); }}>
          {sel?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {more && (
        <div className="qc-row">
          <label>프로젝트
            <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value={0}>없음</option>
              {areaProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>우선순위
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="qc-foot">
        {!more && <button className="qc-more" onClick={() => setMore(true)}>+ 옵션</button>}
        <span style={{ flex: 1 }} />
        <button className="btn-brand qc-save" onClick={save} disabled={busy || !title.trim()}>{busy ? "만드는 중…" : "만들기"}</button>
      </div>
    </div>
  );
}
