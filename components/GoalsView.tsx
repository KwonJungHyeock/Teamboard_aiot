"use client";

// 목표 화면 (Phase 4 → 파트 C) — 탭(팀 목표/내 목표) + 연도 필터 + 트리 + 보관함.
// 목표 클릭 시 우측 상세 슬라이드 패널(GoalDetailPanel)이 열린다.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import PageShell from "./PageShell";
import GoalTree, { type LinkableTask } from "./GoalTree";
import EmptyState from "./EmptyState";
import AreaFilter, { useAreaChips, useAreaSelection } from "./AreaFilter";
import SectionEmpty from "./SectionEmpty";
import Skeleton from "./Skeleton";
import ErrorNote from "./ErrorNote";
import NewGoalModal from "./NewGoalModal";
import GoalLinkBanner from "./GoalLinkBanner";
import UnlinkedTaskPanel, { type UnlinkedTask, type MonthGoalOption } from "./UnlinkedTaskPanel";
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
  // 사이드바 "내 목표"가 /goals?tab=personal 로 들어온다 (MD-P-2026-025 §A1).
  // 탭은 계속 로컬 상태다 — URL 은 첫 진입에만 쓴다(탭 전환마다 히스토리를 남기지 않는다).
  const initialTab: Tab = useSearchParams().get("tab") === "personal" ? "personal" : "team";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [tree, setTree] = useState<GoalNode[]>([]);
  const [linkableTasks, setLinkableTasks] = useState<LinkableTask[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedProject[]>([]);
  const [unlinkedTasks, setUnlinkedTasks] = useState<UnlinkedTask[]>([]);
  const [monthGoals, setMonthGoals] = useState<MonthGoalOption[]>([]);
  const [showUnlinked, setShowUnlinked] = useState(false);
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
  // 영역 축 — /tasks · /projects 와 같은 컴포넌트·같은 URL 형식(?area=2,3) (B11-3)
  const areas = useAreaChips();
  const [areaIds, toggleArea, clearAreas, areaQs] = useAreaSelection();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals?scope=${tab}${yearQ}${areaQs ? `&area=${areaQs}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "목표 조회 실패");
      setTree(data.tree ?? []);
      setLinkableTasks(data.linkableTasks ?? []);
      setUnlinked(data.unlinkedProjects ?? []);
      setUnlinkedTasks(data.unlinkedTasks ?? []);
      setMonthGoals(data.monthGoals ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [tab, yearQ, areaQs]);

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
        // 확정 연결 모델은 "업무를 개별로 월 목표에 연결"이다 (회신 6).
        // 프로젝트를 붙이라던 옛 안내가 남아 있어 바꾼다.
        ? "팀 목표 — 연간 → 분기 → 월. 업무를 월 목표에 연결하면 진척이 상위로 자동 집계됩니다."
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
          {/* 영역 축 (B11-3) — 트리는 상위/하위가 이어져야 하므로 서버가
              "자기 또는 자손이 그 영역"인 목표를 남긴다. 월 목표만 영역을 갖는 경우가 많다. */}
          <AreaFilter areas={areas} selected={areaIds} onToggle={toggleArea} onClear={clearAreas} />
        </>
      }
    >
    {/* 본문 CSS 가 home.css 에 `.hv …` 로 스코프돼 있다 — 래퍼를 지우면 트리 스타일이 통째로 죽는다.
        (MD-P-2026-022 §A 1~4 에서 이 래퍼가 빠져 목표 트리가 깨져 있었다) */}
    <div className="hv pg-legacy">
      {/* §B3 — 목표에 안 붙은 프로젝트가 있으면 여기서 한 번에 연결한다 */}
      {/* 지시 22 — 진짜 문제는 목표에 안 붙은 "업무"다. 프로젝트가 아니다.
          0건이면 배너를 그리지 않는다. 코랄을 쓰지 않는다(중립 톤). */}
      {tab === "team" && unlinkedTasks.length > 0 && (
        <button className="ulbanner" onClick={() => setShowUnlinked((v) => !v)} aria-expanded={showUnlinked}>
          <b className="num">{unlinkedTasks.length}건</b>
          <span>목표에 연결되지 않은 업무 · 진척에 집계되지 않습니다</span>
          <span className="gsp" />
          <em>{showUnlinked ? "닫기" : "연결하기 →"}</em>
        </button>
      )}
      {tab === "team" && showUnlinked && (
        <UnlinkedTaskPanel tasks={unlinkedTasks} monthGoals={monthGoals} onChanged={load} />
      )}
      {/* 프로젝트→목표 연결은 폴백으로 남긴다 (회신 6 [확정] 연결 모델) */}
      {tab === "team" && unlinkedTasks.length === 0 && (
        <GoalLinkBanner projects={unlinked} tree={tree} onLinked={load} />
      )}

      {loading && <Skeleton variant="list" />}
      {error && <ErrorNote message="목표를 불러오지 못했어요" cause={error} onRetry={load} />}
      {!loading && !error && tree.length === 0 && (
        <EmptyState
          icon="tasks"
          title={
            areaIds.length > 0 ? "이 영역에 목표가 없어요"
              : tab === "team" ? "팀 목표가 없어요" : "내 개인 목표가 없어요"
          }
          hint={
            areaIds.length > 0
              ? "위 영역 칩을 바꾸거나 전체 영역으로 돌리면 다른 목표를 볼 수 있어요."
              : tab === "team"
                ? "팀장이 연간 목표를 세우고 분기·월로 나누면, 연결된 업무 진척이 여기 모입니다."
                : "개인 목표를 세우고 내 업무를 연결해 나만의 진척을 관리하세요. 나만 볼 수 있어요."
          }
          action={
            tab === "personal" || user.role === "lead" ? (
              <button className="btn-primary" onClick={() => setShowNew(true)}>목표 만들기</button>
            ) : undefined
          }
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

      {showArchive && (
        <div className="dl garchive">
          <div className="dl-head"><span className="dl-c">보관함 — {year ?? "전체"}년</span></div>
          {archiveError && <ErrorNote message="보관함을 불러오지 못했어요" cause={archiveError} onRetry={loadArchive} />}
          {archived.length === 0 && !archiveError && (
            <SectionEmpty text="보관된 목표가 없어요" />
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
