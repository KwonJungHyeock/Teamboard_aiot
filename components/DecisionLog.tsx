"use client";

// 결정 로그 화면 (MD-P-2026-004 §C) — 프로젝트 상세 탭 · 논의·결정 페이지 탭 공용.
// 최신순 기본. 필터(프로젝트·결정자·기간·상태) + 결정 내용·근거 본문 검색.
import { useCallback, useEffect, useState } from "react";
import EmptyState from "./EmptyState";
import { DecisionListItem, type Decision } from "./decision-ui";

interface Opt { id: number; name: string }

export default function DecisionLog({ projectId }: { projectId?: number }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<Opt[]>([]);
  const [actors, setActors] = useState<Opt[]>([]);
  // 필터
  const [fProject, setFProject] = useState("");
  const [fBy, setFBy] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState("");

  // 검색 디바운스 — 타이핑마다 조회하지 않는다
  useEffect(() => {
    const t = setTimeout(() => setQ(qLive.trim()), 300);
    return () => clearTimeout(t);
  }, [qLive]);

  useEffect(() => {
    if (projectId) return; // 프로젝트 탭은 프로젝트 필터 불필요
    fetch("/api/meta/selectors").then((r) => r.json())
      .then((d) => { setProjects(d.projects ?? []); setActors(d.actors ?? []); })
      .catch(() => {});
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    fetch("/api/meta/selectors").then((r) => r.json())
      .then((d) => setActors(d.actors ?? [])).catch(() => {});
  }, [projectId]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      const pid = projectId ? String(projectId) : fProject;
      if (pid) qs.set("project", pid);
      if (fBy) qs.set("decidedBy", fBy);
      if (fStatus) qs.set("status", fStatus);
      if (fFrom) qs.set("from", fFrom);
      if (fTo) qs.set("to", fTo);
      if (q) qs.set("q", q);
      const res = await fetch(`/api/decisions?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "결정 조회 실패");
      setDecisions(data.decisions ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [projectId, fProject, fBy, fStatus, fFrom, fTo, q]);

  useEffect(() => { load(); }, [load]);

  const filtered = fProject || fBy || fStatus || fFrom || fTo || q;

  return (
    <section className="card dlog" aria-label="결정 로그">
      <div className="dlog-bar">
        <input className="dlog-q" type="search" value={qLive} placeholder="결정 내용·근거 검색"
          onChange={(e) => setQLive(e.target.value)} aria-label="결정 검색" />
        {!projectId && (
          <select value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label="프로젝트">
            <option value="">전체 프로젝트</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={fBy} onChange={(e) => setFBy(e.target.value)} aria-label="결정자">
          <option value="">전체 결정자</option>
          {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="상태">
          <option value="">전체 상태</option>
          <option value="confirmed">확정</option>
          <option value="superseded">번복</option>
        </select>
        <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} aria-label="시작일" />
        <span className="dlog-tilde">~</span>
        <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} aria-label="종료일" />
        {filtered && (
          <button className="dlog-reset" onClick={() => { setFProject(""); setFBy(""); setFStatus(""); setFFrom(""); setFTo(""); setQLive(""); }}>
            초기화
          </button>
        )}
      </div>

      {loading ? (
        <p className="gempty">불러오는 중...</p>
      ) : error ? (
        <p className="gerr">{error}</p>
      ) : decisions.length === 0 ? (
        <EmptyState
          icon="chat"
          title={filtered ? "조건에 맞는 결정이 없어요" : "아직 확정된 결정이 없어요."}
          hint={filtered ? "필터를 바꾸거나 초기화해 보세요." : "논의를 해결하면 여기에 자동으로 쌓입니다."}
        />
      ) : (
        <div className="dlist">
          {decisions.map((d) => <DecisionListItem key={d.id} decision={d} />)}
        </div>
      )}
    </section>
  );
}
