"use client";

// 목표 화면 (Phase 4 → 파트 C) — 탭(팀 목표/내 목표) + 연도 필터 + 트리 + 보관함.
// 목표 클릭 시 우측 상세 슬라이드 패널(GoalDetailPanel)이 열린다.
import { useCallback, useEffect, useState } from "react";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import GoalTree, { type LinkableTask } from "./GoalTree";
import EmptyState from "./EmptyState";
import NewGoalModal from "./NewGoalModal";
import GoalLinkBanner from "./GoalLinkBanner";
import { GOAL_UPDATED_EVENT, openGoalPanel } from "@/lib/goal-panel";

type Tab = "team" | "personal";
const YEARS = [2025, 2026] as const;

interface UnlinkedProject { id: number; name: string; color_key: string | null; status: string }

interface ArchivedGoal {
  id: number;
  title: string;
  period_type: string;
  period_start: string;
}

const PERIOD_LABEL: Record<string, string> = { year: "연간", quarter: "분기", month: "월" };

export default function GoalsView({ user, initialYear }: { user: SessionUser; initialYear: number }) {
  const [year, setYear] = useState<number | null>(initialYear); // null = 전체
  const [tab, setTab] = useState<Tab>("team");
  const [tree, setTree] = useState<GoalNode[]>([]);
  const [linkableTasks, setLinkableTasks] = useState<LinkableTask[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  const [archived, setArchived] = useState<ArchivedGoal[]>([]);
  const [archiveError, setArchiveError] = useState("");
  const [showNew, setShowNew] = useState(false);

  // 홈의 "내 목표 N건 →" 링크로 들어오면 개인 탭으로 연다 (§E·F)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("scope") === "personal") setTab("personal");
  }, []);

  const yearQ = year ? `&year=${year}` : "";
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals?scope=${tab}${yearQ}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "목표 조회 실패");
      setTree(data.tree ?? []);
      setLinkableTasks(data.linkableTasks ?? []);
      setUnlinked(data.unlinkedProjects ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [tab, yearQ]);

  const loadArchive = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals?archived=1${yearQ}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "보관함 조회 실패");
      setArchived(data.archived ?? []);
      setArchiveError("");
    } catch (e) {
      setArchiveError(e instanceof Error ? e.message : "오류");
    }
  }, [yearQ]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // 목표 변경(패널 저장·진척 재계산) 시 목록 재동기화
  useEffect(() => {
    const onUpd = () => load();
    window.addEventListener(GOAL_UPDATED_EVENT, onUpd);
    return () => window.removeEventListener(GOAL_UPDATED_EVENT, onUpd);
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
            <p>
              {tab === "team"
                ? "팀 목표 — 연간 → 분기 → 월. 목표에 프로젝트를 연결하면 프로젝트 진척이 상위로 자동 집계됩니다."
                : "내 목표 — 본인과 팀장만 봅니다. 같은 3계층·같은 집계 규칙으로 관리하세요."}
            </p>
          </div>
          <div className="head-r">
            <div className="seg" role="group" aria-label="연도 필터">
              {YEARS.map((y) => (
                <button key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>
              ))}
              <button aria-pressed={year === null} onClick={() => setYear(null)}>전체</button>
            </div>
            <button className="btn-brand goal-new" onClick={() => setShowNew(true)}>+ 새 목표</button>
          </div>
        </div>

        <div className="seg goal-seg" role="group" aria-label="목표 범위">
          <button aria-pressed={tab === "team"} onClick={() => setTab("team")}>팀 목표</button>
          <button aria-pressed={tab === "personal"} onClick={() => setTab("personal")}>내 목표</button>
        </div>

        {/* §B3 — 목표에 안 붙은 프로젝트가 있으면 여기서 한 번에 연결한다 */}
        {tab === "team" && <GoalLinkBanner projects={unlinked} tree={tree} onLinked={load} />}

        <section className="card">
          {loading && <p className="gempty">불러오는 중...</p>}
          {error && <p className="gerr">{error}</p>}
          {!loading && !error && tree.length === 0 && (
            <EmptyState
              title={tab === "team" ? "팀 목표가 없어요" : "내 개인 목표가 없어요"}
              hint={tab === "team"
                ? "팀장이 연간 목표를 세우고 분기·월로 나누면, 연결된 업무 진척이 여기 모입니다."
                : "개인 목표를 세우고 내 업무를 연결해 나만의 진척을 관리하세요. (나만 볼 수 있어요)"}
              action={(tab === "personal" || user.role === "lead") ? (
                <button className="btn small primary" onClick={() => setShowNew(true)}>목표 만들기</button>
              ) : undefined}
            />
          )}
          {!loading && !error && tree.length > 0 && (
            <GoalTree
              tree={tree}
              linkableTasks={linkableTasks}
              user={user}
              year={year ?? new Date().getFullYear()}
              onChanged={load}
              onOpenGoal={openGoalPanel}
              scope={tab}
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

      {showNew && (
        <NewGoalModal
          user={user}
          scope={tab}
          year={year ?? new Date().getFullYear()}
          tree={tree}
          onClose={() => setShowNew(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
