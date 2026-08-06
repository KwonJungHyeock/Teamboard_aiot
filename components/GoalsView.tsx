"use client";

// 목표 화면 (Phase 4 → 파트 C) — 탭(팀 목표/내 목표) + 연도 필터 + 트리 + 보관함.
// 목표 클릭 시 우측 상세 슬라이드 패널(GoalDetailPanel)이 열린다.
import { useCallback, useEffect, useState } from "react";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import PageShell from "./PageShell";
import GoalTree, { type LinkableTask } from "./GoalTree";
import EmptyState from "./EmptyState";
import NewGoalModal from "./NewGoalModal";
import GoalLinkBanner from "./GoalLinkBanner";
import SnapshotMenu from "./SnapshotMenu";
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
    <PageShell
      crumb={["워크스페이스", "목표"]}
      title="목표"
      subtitle={tab === "team"
        ? "팀 목표 — 연간 → 분기 → 월. 목표에 프로젝트를 연결하면 프로젝트 진척이 상위로 자동 집계됩니다."
        : "내 목표 — 본인과 팀장만 봅니다. 같은 3계층·같은 집계 규칙으로 관리하세요."}
      actions={
        <>
          {user.role === "lead" && <SnapshotMenu onSaved={load} />}
          <button className="btn-primary" onClick={() => setShowNew(true)}>＋ 새 목표</button>
        </>
      }
      tabs={[
        { key: "team", label: "팀 목표" },
        { key: "personal", label: "내 목표" },
      ]}
      activeTab={tab}
      onTab={(k) => setTab(k as "team" | "personal")}
      filters={
        <>
          {YEARS.map((y) => (
            <button key={y} className={`pg-chip${year === y ? " on" : ""}`} onClick={() => setYear(y)}>{y}</button>
          ))}
          <button className={`pg-chip${year === null ? " on" : ""}`} onClick={() => setYear(null)}>전체</button>
          <button className="pg-chip" onClick={() => setShowArchive((v) => !v)}>
            {showArchive ? "보관함 닫기" : "보관함"}
          </button>
        </>
      }
    >
    {/* 본문 CSS 가 home.css 에 `.hv …` 로 스코프돼 있다 — 래퍼를 지우면 트리 스타일이 통째로 죽는다.
        (MD-P-2026-022 §A 1~4 에서 이 래퍼가 빠져 목표 트리가 깨져 있었다) */}
    <div className="hv pg-legacy">
      {/* §B3 — 목표에 안 붙은 프로젝트가 있으면 여기서 한 번에 연결한다 */}
      {tab === "team" && <GoalLinkBanner projects={unlinked} tree={tree} onLinked={load} />}

      {loading && <p className="gempty">불러오는 중...</p>}
      {error && <p className="gerr">{error}</p>}
      {!loading && !error && tree.length === 0 && (
        <div className="dl">
          <div className="dl-empty">
            <p>{tab === "team" ? "팀 목표가 없어요" : "내 개인 목표가 없어요"}</p>
            <p className="dl-empty-sub">
              {tab === "team"
                ? "팀장이 연간 목표를 세우고 분기·월로 나누면, 연결된 업무 진척이 여기 모입니다."
                : "개인 목표를 세우고 내 업무를 연결해 나만의 진척을 관리하세요. (나만 볼 수 있어요)"}
            </p>
            {(tab === "personal" || user.role === "lead") && (
              <button className="btn-primary" onClick={() => setShowNew(true)}>목표 만들기</button>
            )}
          </div>
        </div>
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

      {showArchive && (
        <div className="dl garchive">
          <div className="dl-head"><span className="dl-c">보관함 — {year ?? "전체"}년</span></div>
          {archiveError && <p className="gerr">{archiveError}</p>}
          {archived.length === 0 && !archiveError && (
            <div className="dl-empty"><p>보관된 목표가 없습니다.</p></div>
          )}
          {archived.map((goal) => (
            <div key={goal.id} className="dl-row">
              <span className="dl-c" style={{ flex: "0 0 46px" }}>
                <span className="gtag">{PERIOD_LABEL[goal.period_type] ?? goal.period_type}</span>
              </span>
              <span className="dl-c">{goal.title}</span>
              <span className="dl-c num" style={{ flex: "0 0 100px" }}>{goal.period_start}</span>
              <span className="dl-c" style={{ flex: "0 0 60px", textAlign: "right" }}>
                {user.role === "lead" && <button className="lk" onClick={() => restore(goal)}>복구</button>}
              </span>
            </div>
          ))}
        </div>
      )}

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
    </PageShell>
  );
}
