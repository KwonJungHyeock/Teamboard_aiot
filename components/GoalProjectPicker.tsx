"use client";

// 목표 ↔ 프로젝트 연결 팝오버 (MD-P-2026-009 §B1)
// 화면을 옮기지 않고 다중 선택으로 붙인다. 이미 다른 목표에 연결된 프로젝트도 고를 수 있고,
// 그 경우 "○○ 목표에 연결됨"을 명시해 사용자가 옮기는 것임을 알고 누르게 한다.
import { useEffect, useState } from "react";
import { toast } from "@/lib/quick";
import SectionEmpty from "./SectionEmpty";
import Skeleton from "./Skeleton";

interface Candidate {
  id: number;
  name: string;
  colorKey: string | null;
  status: string;
  progress: number | null;
  taskCount: number;
  linkedGoalId: number | null;
  linkedGoalTitle: string | null;
}

export default function GoalProjectPicker({
  goalId, onClose, onLinked,
}: { goalId: number; onClose: () => void; onLinked: () => void }) {
  const [cands, setCands] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/goals/${goalId}/projects`)
      .then((r) => r.json())
      .then((d) => setCands(d.candidates ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [goalId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function link() {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    const res = await fetch(`/api/goals/${goalId}/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectIds: picked }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { toast("연결에 실패했어요", "err"); return; }
    toast(`프로젝트 ${picked.length}개를 연결했어요`);
    onLinked();
  }

  const needle = q.trim().toLowerCase();
  const shown = needle ? cands.filter((c) => c.name.toLowerCase().includes(needle)) : cands;

  return (
    <div className="gpp-bg" role="presentation" onClick={onClose}>
      <div className="gpp" role="dialog" aria-modal="true" aria-label="프로젝트 연결" onClick={(e) => e.stopPropagation()}>
        <div className="gpp-h">
          <b>프로젝트 연결</b>
          <button className="gpanel-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <input className="gpp-q" placeholder="프로젝트 검색" value={q} autoFocus
          onChange={(e) => setQ(e.target.value)} />
        <div className="gpp-list">
          {loading && <Skeleton variant="list" rows={3} />}
          {!loading && shown.length === 0 && <SectionEmpty text="연결할 수 있는 프로젝트가 없어요" />}
          {shown.map((c) => (
            <label key={c.id} className={`gpp-row${picked.includes(c.id) ? " on" : ""}`}>
              <input type="checkbox" checked={picked.includes(c.id)}
                onChange={(e) => setPicked((cur) => e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id))} />
              <span className={`pjdot ${c.colorKey ?? "team"}`} />
              <span className="gpp-name">{c.name}</span>
              {c.linkedGoalTitle && <span className="gpp-warn">{c.linkedGoalTitle} 목표에 연결됨</span>}
              <span className={`gpp-p num${c.progress === null ? " none" : ""}`}>
                {c.progress === null ? "–" : `${c.progress}%`}
              </span>
            </label>
          ))}
        </div>
        <div className="gpp-foot">
          <span className="gpp-note">
            {picked.some((id) => cands.find((c) => c.id === id)?.linkedGoalId)
              ? "다른 목표에 연결된 프로젝트는 이 목표로 옮겨집니다."
              : "연결하면 진척이 즉시 재계산됩니다."}
          </span>
          <button className="btn-outline" onClick={onClose}>취소</button>
          <button className="btn-brand" onClick={link} disabled={busy || picked.length === 0}>
            {busy ? "연결 중…" : `연결 (${picked.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
