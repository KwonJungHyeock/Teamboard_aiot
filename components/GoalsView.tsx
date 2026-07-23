"use client";

// 목표 화면 (Phase 4) — 연도 선택 + 트리
import { useCallback, useEffect, useState } from "react";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import GoalTree, { type LinkableTask } from "./GoalTree";

export default function GoalsView({ user, initialYear }: { user: SessionUser; initialYear: number }) {
  const [year, setYear] = useState(initialYear);
  const [tree, setTree] = useState<GoalNode[]>([]);
  const [linkableTasks, setLinkableTasks] = useState<LinkableTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

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
        </section>
      </div>
    </div>
  );
}
