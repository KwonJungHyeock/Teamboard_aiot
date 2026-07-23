"use client";

// 전체 프로젝트 인덱스 (Phase 5 — SPEC v1.1 개정 예정 화면).
// 카드: 이름 · 진행률 바 · 상태 · 목표 수 · 열린 업무 수. 상태 필터 + lead 새 프로젝트.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SessionUser } from "@/lib/types";

interface ProjectCard {
  id: number;
  name: string;
  status: string;
  colorKey: string | null;
  total: number;
  done: number;
  openCount: number;
  goalCount: number;
  percent: number | null;
}

const STATUS_LABEL: Record<string, string> = { active: "진행중", done: "완료", hold: "보류" };

function NewProjectForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [colorKey, setColorKey] = useState("team");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, colorKey }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "생성 실패");
      return;
    }
    setName("");
    onDone();
  }

  return (
    <div className="tnew">
      <input
        placeholder="새 프로젝트 이름"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <select value={colorKey} onChange={(e) => setColorKey(e.target.value)}>
        <option value="team">기본색</option>
        <option value="edu">edu</option>
        <option value="play">play</option>
        <option value="train">train</option>
      </select>
      <button className="lk" onClick={submit} disabled={busy || !name.trim()}>
        새 프로젝트
      </button>
      {error && <span className="gerr">{error}</span>}
    </div>
  );
}

export default function ProjectsIndexView({ user }: { user: SessionUser }) {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [filter, setFilter] = useState(""); // '' = 전체
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "프로젝트 조회 실패");
      setProjects(data.projects ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = projects.filter((p) => !filter || p.status === filter);

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>전체 프로젝트</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">PROJECTS</div>
            <h1>전체 프로젝트</h1>
            <p>진행률·목표·열린 업무는 서버가 DB에서 집계한 값입니다.</p>
          </div>
          <div className="seg" role="group" aria-label="상태 필터">
            {[
              ["", "전체"],
              ["active", "진행중"],
              ["done", "완료"],
              ["hold", "보류"],
            ].map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="gempty">불러오는 중...</p>}
        {error && <p className="gerr">{error}</p>}

        <div className="pgrid">
          {!loading &&
            shown.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="pcard card">
                <div className="pcard-h">
                  <span className="pj">
                    <i className={p.colorKey ?? "team"} />
                    <b>{p.name}</b>
                  </span>
                  <span className="gsp" />
                  <span className={`pst ${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                </div>
                <div className="pcard-bar">
                  <div className="bar">
                    <i
                      className={p.colorKey ?? "team"}
                      style={{ width: `${p.percent ?? 0}%` }}
                    />
                  </div>
                  <span className="gpv">{p.percent === null ? "-" : `${p.percent}%`}</span>
                </div>
                <div className="pcard-m">
                  <span>목표 {p.goalCount}</span>
                  <span>열린 업무 {p.openCount}</span>
                  <span>
                    완료 {p.done}/{p.total}
                  </span>
                </div>
              </Link>
            ))}
          {!loading && shown.length === 0 && (
            <p className="gempty">해당 상태의 프로젝트가 없습니다.</p>
          )}
        </div>

        {user.role === "lead" && <NewProjectForm onDone={load} />}
      </div>
    </div>
  );
}
