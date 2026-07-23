"use client";

// 목표 화면 (Phase 4) — 연도 선택 + 트리 + 보관함(토글)
import { useCallback, useEffect, useState } from "react";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import GoalTree, { type LinkableTask } from "./GoalTree";

interface ArchivedGoal {
  id: number;
  title: string;
  period_type: string;
  period_start: string;
}

const PERIOD_LABEL: Record<string, string> = { year: "연간", quarter: "분기", month: "월" };

export default function GoalsView({ user, initialYear }: { user: SessionUser; initialYear: number }) {
  const [year, setYear] = useState(initialYear);
  const [tree, setTree] = useState<GoalNode[]>([]);
  const [linkableTasks, setLinkableTasks] = useState<LinkableTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [archived, setArchived] = useState<ArchivedGoal[]>([]);
  const [archiveError, setArchiveError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals?year=${year}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "목표 조회 실패");
      setTree(data.tree ?? []);
      setLinkableTasks(data.linkableTasks ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [year]);

  const loadArchive = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals?archived=1&year=${year}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "보관함 조회 실패");
      setArchived(data.archived ?? []);
      setArchiveError("");
    } catch (e) {
      setArchiveError(e instanceof Error ? e.message : "오류");
    }
  }, [year]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (showArchive) loadArchive();
  }, [showArchive, loadArchive]);

  async function restore(goal: ArchivedGoal) {
    const res = await fetch(`/api/goals/${goal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    if (!res.ok) {
      setArchiveError((await res.json()).error ?? "복구 실패");
      return;
    }
    setArchiveError("");
    await Promise.all([load(), loadArchive()]);
  }

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>목표</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">GOALS</div>
            <h1>목표</h1>
            <p>연간 → 분기 → 월. 월 목표에만 업무를 연결하고, 상위는 집계만 합니다.</p>
          </div>
          <div className="seg" role="group" aria-label="연도 선택">
            <button aria-pressed={false} onClick={() => setYear((y) => y - 1)} aria-label="이전 연도">
              ←
            </button>
            <button aria-pressed={true}>{year}</button>
            <button aria-pressed={false} onClick={() => setYear((y) => y + 1)} aria-label="다음 연도">
              →
            </button>
          </div>
        </div>

        <section className="card">
          {loading && <p className="gempty">불러오는 중...</p>}
          {error && <p className="gerr">{error}</p>}
          {!loading && !error && (
            <GoalTree
              tree={tree}
              linkableTasks={linkableTasks}
              user={user}
              year={year}
              onChanged={load}
            />
          )}
          <div className="garchive-toggle">
            <button className="lk mu" onClick={() => setShowArchive((v) => !v)}>
              {showArchive ? "보관함 닫기" : "보관함 보기"}
            </button>
          </div>
        </section>

        {showArchive && (
          <section className="card garchive">
            <h2 className="garchive-h">보관함 — {year}년</h2>
            {archiveError && <p className="gerr">{archiveError}</p>}
            {archived.length === 0 && !archiveError && (
              <p className="gempty">보관된 목표가 없습니다.</p>
            )}
            {archived.map((goal) => (
              <div key={goal.id} className="garchive-row">
                <span className="gtag">{PERIOD_LABEL[goal.period_type] ?? goal.period_type}</span>
                <span className="gtitle">{goal.title}</span>
                <em className="garchive-p">{goal.period_start}</em>
                <span className="gsp" />
                {user.role === "lead" && (
                  <button className="lk" onClick={() => restore(goal)}>
                    복구
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
