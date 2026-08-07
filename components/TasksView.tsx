"use client";

// 업무 화면 (Phase 5) — 인박스(에이전트 제안) + 필터 목록 + 상세 편집.
// 목록 테이블은 홈 "마감 임박"과 동일한 TaskTable을 재사용한다 (검수 포인트 6).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import TaskTable, { type TaskTableRow } from "./TaskTable";
import Skeleton from "./Skeleton";
import { notifySavedViewsChanged } from "@/lib/saved-views-events";
import ErrorNote from "./ErrorNote";
import PageShell from "./PageShell";
import TaskBoard from "./TaskBoard";
import TaskCalendar from "./TaskCalendar";
import TaskGantt from "./TaskGantt";
import { toast, openQuickCreate } from "@/lib/quick";
import {
  type TaskItem, type TaskLens, type BoardGroup, LENS_LABEL, GROUP_LABEL, dueLabel,
} from "@/lib/task-view";
import { openTaskPanel, TASK_UPDATED_EVENT } from "@/lib/task-panel";

interface AreaOption {
  id: number;
  name: string;
  colorKey: string | null;
}

interface ProjectOption {
  id: number;
  name: string;
  colorKey: string | null;
  areaId: number;
}

interface InboxItem {
  id: number;
  title: string;
  description: string;
  projectName: string | null;
  colorKey: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  createdByName: string | null;
}

interface Option {
  id: number;
  name: string;
}

interface MonthGoalOption {
  id: number;
  title: string;
  month: string; // YYYY-MM
}

const STATUS_OPTIONS = [
  ["", "전체 상태"],
  ["todo", "대기"],
  ["doing", "진행"],
  ["review", "리뷰"],
  ["done", "완료"],
  ["dropped", "중단"],
] as const;

const DUE_OPTIONS = [
  ["", "전체 기한"],
  ["overdue", "지연"],
  ["7d", "7일 이내"],
  ["30d", "30일 이내"],
  ["none", "기한 없음"],
] as const;

/** 정렬 기준 (MD-P-2026-018 §D) — 기본은 기한순. 선택은 사용자별로 기억한다. */
type SortKey = "due" | "priority" | "recent" | "progress";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "due", label: "기한순" },
  { key: "priority", label: "우선순위순" },
  { key: "recent", label: "최신 작성순" },
  { key: "progress", label: "진척순" },
];
const PRIORITY_RANK: Record<string, number> = { high: 0, mid: 1, medium: 1, normal: 1, low: 2 };

export default function TasksView({ user }: { user: SessionUser }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [actors, setActors] = useState<Option[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [myAreaIds, setMyAreaIds] = useState<number[]>([]);
  const [monthGoals, setMonthGoals] = useState<MonthGoalOption[]>([]);
  const [linkGoals, setLinkGoals] = useState<{ id: number; title: string }[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // 필터 (영역 · 프로젝트 · 담당 · 상태 · 기한). 담당 기본값=본인 → "내 업무" 진입.
  //
  // 영역은 **여러 개**를 고를 수 있다 (MD-P-2026-027 §B2).
  // 사이드바에서 영역 7개를 내리고 여기 칩으로 옮겼다 — 사이드바는 "어디로 갈까"이고
  // 영역은 "무엇을 볼까"라서 필터가 맞는 자리다.
  // URL 은 `?area=2,3` 으로 쓴다. 링크로 공유·북마크된다.
  const [fAreas, setFAreas] = useState<number[]>([]);
  const fArea = fAreas.length === 1 ? String(fAreas[0]) : "";   // 새 업무 프리셋용 (하나일 때만 의미가 있다)
  const areaParam = fAreas.join(",");
  const [fProject, setFProject] = useState("");
  const [fAssignee, setFAssignee] = useState(String(user.id));
  const [fStatus, setFStatus] = useState("");
  const [fDue, setFDue] = useState("");
  const [fBlocked, setFBlocked] = useState(false); // 홈 5칸 진입(?blocked=1)
  // 완료 표시 여부 · 정렬 기준 (MD-P-2026-018 §D). 기본은 "완료 제외 + 기한순".
  const [showDone, setShowDone] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("due");
  const [areaDefaulted, setAreaDefaulted] = useState(false);
  const isMine = fAssignee === String(user.id);

  // 새 업무 — 단일 흐름: 빠른 생성 팝오버(현재 영역·담당 프리셋). 별도 생성 시트 없음.
  const quickNew = useCallback((e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openQuickCreate(
      { x: r.left, y: r.bottom + 6 },
      { areaId: fArea ? Number(fArea) : undefined, assigneeId: isMine ? user.id : undefined }
    );
  }, [fArea, isMine, user.id]);

  /**
   * 지금 필터를 저장된 뷰로 만든다 (§B3).
   * 저장하는 것은 **URL 에 담기는 조건 그대로**다 — 그래야 뷰를 눌렀을 때
   * 지금 화면과 같은 것이 뜬다. 화면 상태와 저장 형식이 다르면 반드시 어긋난다.
   */
  const [savingView, setSavingView] = useState(false);
  async function saveCurrentView() {
    const name = window.prompt("이 조건에 붙일 이름")?.trim();
    if (!name) return;
    setSavingView(true);
    const filters: Record<string, string> = {};
    if (areaParam) filters.area = areaParam;
    if (fProject) filters.project = fProject;
    if (fAssignee) filters.assignee = fAssignee;
    if (fStatus) filters.status = fStatus;
    if (fDue) filters.due = fDue;
    if (fBlocked) filters.blocked = "1";
    if (sortBy !== "due") filters.sort = sortBy;
    if (showDone) filters.done = "1";
    const res = await fetch("/api/saved-views", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, target: "tasks", filters }),
    }).catch(() => null);
    setSavingView(false);
    const d = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) { toast(d?.error ?? "저장하지 못했어요", "err"); return; }
    notifySavedViewsChanged();
    toast(`"${name}" 뷰를 저장했어요`);
  }

  /** 영역 칩 토글. 다중 선택이고, 전부 끄면 "전체 영역"이다. */
  function toggleArea(id: number) {
    setAreaDefaulted(true);
    setFAreas((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].sort((a, b) => a - b)));
  }

  // 뷰(렌즈) 전환 — 마지막 뷰·그룹 기준 기억(localStorage)
  const [lens, setLens] = useState<TaskLens>("sheet");
  const [boardGroup, setBoardGroup] = useState<BoardGroup>("status");
  useEffect(() => {
    const v = localStorage.getItem("tb:tasks-lens") as TaskLens | null;
    if (v && ["sheet", "board", "calendar", "timeline"].includes(v)) setLens(v);
    const g = localStorage.getItem("tb:tasks-group") as BoardGroup | null;
    if (g && ["status", "area", "assignee"].includes(g)) setBoardGroup(g);
    // URL 이 있으면 URL 우선(공유 링크), 없으면 지난 선택을 되살린다
    const sp = new URLSearchParams(window.location.search);
    const urlSort = sp.get("sort") as SortKey | null;
    const urlDone = sp.get("done");
    const savedSort = localStorage.getItem("tb:tasks-sort") as SortKey | null;
    const savedDone = localStorage.getItem("tb:tasks-done");
    const sortPick = urlSort ?? savedSort;
    if (sortPick && SORT_OPTIONS.some((o) => o.key === sortPick)) setSortBy(sortPick);
    if (urlDone === "1") setShowDone(true);
    else if (urlDone === null && savedDone === "1") setShowDone(true);
  }, []);

  function pickSort(v: SortKey) { setSortBy(v); localStorage.setItem("tb:tasks-sort", v); }
  function toggleDone(v: boolean) { setShowDone(v); localStorage.setItem("tb:tasks-done", v ? "1" : "0"); }
  function pickLens(v: TaskLens) { setLens(v); localStorage.setItem("tb:tasks-lens", v); }
  function pickGroup(g: BoardGroup) { setBoardGroup(g); localStorage.setItem("tb:tasks-group", g); }

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (areaParam) qs.set("area", areaParam);
      if (fProject) qs.set("project", fProject);
      if (fAssignee) qs.set("assignee", fAssignee);
      if (fStatus) qs.set("status", fStatus);
      if (fDue) qs.set("due", fDue);
      if (fBlocked) qs.set("blocked", "1");
      const res = await fetch(`/api/tasks?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업무 조회 실패");
      setTasks(data.tasks ?? []);
      setInbox(data.inbox ?? []);
      setToday(data.today ?? "");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [areaParam, fProject, fAssignee, fStatus, fDue, fBlocked]);

  // 셀렉트 룩업은 목록과 분리된 /api/meta/selectors에서 (Phase 8 D-3)
  const loadSelectors = useCallback(async () => {
    const res = await fetch("/api/meta/selectors");
    const data = await res.json();
    if (res.ok) {
      setActors(data.actors ?? []);
      setProjects(data.projects ?? []);
      setAreas(data.areas ?? []);
      setMyAreaIds(data.myAreaIds ?? []);
      setMonthGoals(data.monthGoals ?? []);
      setLinkGoals(data.linkGoals ?? []);
    }
  }, []);

  // 홈 KPI 카드 링크 진입 — ?status·?due 반영 + 팀 전체 범위(담당·영역 전체)로.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const st = sp.get("status");
    const du = sp.get("due");
    const bl = sp.get("blocked");
    if (st || du || bl === "1") {
      if (st) setFStatus(st);
      if (du) setFDue(du);
      if (bl === "1") setFBlocked(true);
      setFAssignee("");
      setAreaDefaulted(true);
    }
    // 마운트 1회
  }, []);

  // 진입 시 영역 기본값: URL ?area 우선, 없으면 본인 기본 영역(actor_area 첫 항목).
  // "내 업무" 진입 = 담당 본인 + 영역 본인 (한 번만 적용, 이후엔 사용자 선택 존중).
  useEffect(() => {
    if (areaDefaulted) return;
    const urlArea = new URLSearchParams(window.location.search).get("area");
    if (urlArea) {
      const ids = urlArea.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length) { setFAreas(ids); setAreaDefaulted(true); }
    } else if (myAreaIds.length > 0) {
      setFAreas([myAreaIds[0]]);
      setAreaDefaulted(true);
    }
  }, [myAreaIds, areaDefaulted]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSelectors();
  }, [loadSelectors]);

  // 상세 패널에서 업무가 바뀌면 목록 재동기화
  useEffect(() => {
    const onUpd = () => load();
    window.addEventListener(TASK_UPDATED_EVENT, onUpd);
    return () => window.removeEventListener(TASK_UPDATED_EVENT, onUpd);
  }, [load]);

  async function judgeInbox(item: InboxItem, approve: boolean) {
    const res = await fetch(`/api/tasks/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: approve ? "todo" : "dropped" }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "처리 실패");
      return;
    }
    load();
  }

  // 인라인 상태 변경 (목록에서 즉시). 권한 규칙은 서버가 유지. 중단은 사유가 필요해 제외.
  async function changeStatus(id: number, status: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "상태 변경 실패");
      return;
    }
    load();
  }

  // 목표 이름 조회 — 월 목표만 보면 분기·연간 목표에 연결된 업무가 링크가 있는데도
  // "—" 로 보인다. 전 레벨 목록(linkGoals)을 먼저 보고 없으면 월 목표로 떨어진다
  // (MD-P-2026-018 §F).
  const goalTitleOf = useCallback(
    (id: number) => linkGoals.find((g) => g.id === id)?.title ?? monthGoals.find((g) => g.id === id)?.title,
    [linkGoals, monthGoals]
  );

  // 보드 드래그 → 기준값 변경 (낙관적 반영 + 실패 시 롤백, 토스트)
  async function moveTask(id: number, patch: Record<string, unknown>) {
    const prev = tasks;
    setTasks((cur) => cur.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t };
      if ("status" in patch) next.status = patch.status as string;
      if ("areaId" in patch) { next.areaId = patch.areaId as number; next.areaName = areas.find((a) => a.id === patch.areaId)?.name ?? t.areaName; }
      if ("assigneeId" in patch) { next.assigneeId = (patch.assigneeId as number | null) ?? null; next.assigneeName = actors.find((a) => a.id === patch.assigneeId)?.name ?? null; }
      return next;
    }));
    toast("옮겼어요");
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setTasks(prev);
      toast((await res.json().catch(() => ({}))).error ?? "이동에 실패했어요", "err");
    } else {
      load();
    }
  }

  // 검색·완료필터·정렬이 적용된 업무 목록 — 모든 렌즈가 공유 (MD-P-2026-018 §D)
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = tasks.filter(
      (t) =>
        (showDone || (t.status !== "done" && t.status !== "dropped")) &&
        (!q ||
          t.title.toLowerCase().includes(q) ||
          (t.projectName ?? "").toLowerCase().includes(q) ||
          (t.assigneeName ?? "").toLowerCase().includes(q))
    );

    const prio = (t: TaskItem) => PRIORITY_RANK[t.priority] ?? 1;
    // 기한 없는 항목은 항상 맨 뒤 — 날짜 비교에 끌어들이면 순서가 뒤죽박죽이 된다
    const dueKey = (t: TaskItem) => t.dueDate ?? "9999-12-31";
    const recent = (t: TaskItem) => t.createdAt ?? "";

    const cmp: Record<SortKey, (a: TaskItem, b: TaskItem) => number> = {
      // 지연 → 임박 → 여유 → 기한없음. 동률이면 우선순위, 그다음 최신 작성순.
      due: (a, b) =>
        dueKey(a).localeCompare(dueKey(b)) || prio(a) - prio(b) || recent(b).localeCompare(recent(a)),
      priority: (a, b) =>
        prio(a) - prio(b) || dueKey(a).localeCompare(dueKey(b)) || recent(b).localeCompare(recent(a)),
      recent: (a, b) => recent(b).localeCompare(recent(a)) || b.id - a.id,
      progress: (a, b) => (b.progress ?? 0) - (a.progress ?? 0) || dueKey(a).localeCompare(dueKey(b)),
    };
    return out.slice().sort(cmp[sortBy]);
  }, [tasks, search, showDone, sortBy]);

  // 필터·정렬을 URL 에 반영해 링크로 공유할 수 있게 한다 (MD-P-2026-018 §D).
  // history 를 쌓지 않는다 — 뒤로가기가 필터 변경 이력으로 채워지면 화면을 벗어날 수 없다.
  useEffect(() => {
    if (loading) return;
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null) => (v ? sp.set(k, v) : sp.delete(k));
    set("area", areaParam || null);
    set("project", fProject || null);
    set("assignee", fAssignee || null);
    set("status", fStatus || null);
    set("due", fDue || null);
    set("blocked", fBlocked ? "1" : null);
    set("sort", sortBy === "due" ? null : sortBy);
    set("done", showDone ? "1" : null);
    const qs = sp.toString();
    window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [loading, areaParam, fProject, fAssignee, fStatus, fDue, fBlocked, sortBy, showDone]);

  const rows: TaskTableRow[] = useMemo(() => {
    return filteredTasks
      .map((t) => {
        const d = dueLabel(t, today);   // 완료면 "완료 YYYY-MM-DD" (§E)
        return {
          id: t.id,
          title: t.title,
          projectName: t.projectName,
          colorKey: t.colorKey,
          assigneeName: t.assigneeName,
          status: t.status,
          priority: t.priority,
          areaName: t.areaName,
          progress: t.progress,
          goalNames: t.goalIds.map(goalTitleOf).filter((x): x is string => !!x),
          dday: d.text,
          overdue: d.overdue && t.status !== "done" && t.status !== "dropped",
          blocked: t.blocked,
          blockedReason: t.blockedReason,
          visibility: t.visibility,   // §B2 "개인" 칩
        };
      });
  }, [filteredTasks, today, goalTitleOf]);

  /**
   * 전체 빈 상태가 떠 있는가 (MD-P-2026-026 §A).
   * 그때는 빈 상태 안의 CTA 가 헤더 액션과 **같은 동작**을 한다.
   * 코랄 버튼을 둘 두면 어느 것이 지금 할 일인지 알 수 없다 (§B 주 액션 1개).
   */
  const emptyNow = !loading && !error && lens === "sheet" && rows.length === 0;

  const hiddenDone = tasks.filter((t) => t.status === "done" || t.status === "dropped").length;

  return (
    /* 페이지 뼈대는 공통 컴포넌트가 그린다 (MD-P-2026-019 §B) —
       브레드크럼 → 제목+액션 → 탭 → 필터바 → 본문 순서를 화면마다 다시 짜지 않는다. */
    <PageShell
      crumb={["워크스페이스", "업무"]}
      title={isMine ? "내 업무" : "업무"}
      subtitle={isMine
        ? "담당이 나인 업무만 보고 있습니다. 담당을 ‘전체 담당’으로 바꾸면 전체를 조회합니다."
        : "에이전트 제안은 인박스에서 승인해야 목록·홈·캘린더에 반영됩니다."}
      // 전체 빈 상태가 떠 있으면 그 안의 CTA 가 같은 동작을 한다 — 같은 코랄 버튼을 둘 두지 않는다 (§B)
      actions={emptyNow ? undefined : <button className="btn-primary" onClick={quickNew}>＋ 새 업무</button>}
      tabs={(["sheet", "board", "calendar", "timeline"] as TaskLens[]).map((v) => ({ key: v, label: LENS_LABEL[v] }))}
      activeTab={lens}
      onTab={(k) => pickLens(k as TaskLens)}
      filters={
        <>
          <input className="tsearch" placeholder="업무·프로젝트·담당 검색"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {/* 영역 칩 — 다중 선택. 색 점은 사이드바에서 쓰던 영역 색을 그대로 쓴다 (§B2) */}
          <button className={`pg-chip${fAreas.length === 0 ? " on" : ""}`}
            onClick={() => { setFAreas([]); setAreaDefaulted(true); }}>전체 영역</button>
          {areas.map((a) => (
            <button key={a.id} className={`pg-chip area-chip${fAreas.includes(a.id) ? " on" : ""}`}
              aria-pressed={fAreas.includes(a.id)} onClick={() => toggleArea(a.id)}>
              <i className={`pjdot ${a.colorKey ?? "team"}`} />
              {a.name}
            </button>
          ))}
          <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
            <option value="">전체 담당</option>
            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => pickSort(e.target.value as SortKey)} aria-label="정렬 기준">
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}{o.key === "due" ? " (기본)" : ""}</option>)}
          </select>
          <button className={`pg-chip${showDone ? " on" : ""}`} onClick={() => toggleDone(!showDone)}>
            완료 포함
          </button>
          {/* 지금 조건에 이름을 붙여 저장한다 (§B3). 저장된 뷰는 「내 공간」 아래 핀으로 붙는다.
              버튼이 아니라 텍스트 링크다 — 화면의 주 액션이 아니다. */}
          <button className="lk tv-savefilter" onClick={saveCurrentView} disabled={savingView}>
            이 조건 저장
          </button>
        </>
      }
      filterSummary={`${filteredTasks.length}건${!showDone && hiddenDone > 0 ? ` · 완료 ${hiddenDone}건 숨김` : ""}`}
    >
      <div className="hv tv-legacy">
      <div className="wrap">

        {/* 인박스 — status='proposed' 전용 노출 위치 (홈·캘린더·타임라인 제외) */}
        {inbox.length > 0 && (
          <section className="card tinbox" aria-label="인박스">
            <div className="ch">
              <h2>인박스</h2>
              <span className="sub">에이전트 제안 {inbox.length}건 — 승인 시 업무로 전환</span>
            </div>
            {inbox.map((item) => (
              <div key={item.id} className="tinbox-row">
                <span className="st prop">제안</span>
                <div className="tinbox-b">
                  <b>{item.title}</b>
                  <em>
                    {[item.createdByName, item.projectName, item.assigneeName && `${item.assigneeName} 담당`, item.dueDate]
                      .filter(Boolean)
                      .join(" · ")}
                  </em>
                </div>
                <span className="gsp" />
                <button className="lk" onClick={() => judgeInbox(item, true)}>
                  승인
                </button>
                <button className="lk mu" onClick={() => judgeInbox(item, false)}>
                  기각
                </button>
              </div>
            ))}
          </section>
        )}

        {/* 보드 그룹 기준만 남긴다 — 뷰 탭·정렬·완료 포함은 페이지 뼈대(PageShell)로 올렸다 */}
        {lens === "board" && (
          <div className="lens-bar">
            <div className="lens-group" role="group" aria-label="그룹 기준">
              <span className="lens-group-l">그룹</span>
              {(["status", "area", "assignee"] as BoardGroup[]).map((g) => (
                <button key={g} className="lens-gbtn" aria-pressed={boardGroup === g} onClick={() => pickGroup(g)}>
                  {GROUP_LABEL[g]}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && <Skeleton variant="list" />}
        {error && <ErrorNote message="업무를 불러오지 못했어요" cause={error} onRetry={load} />}
        {!loading && !error && lens === "sheet" && (
          <TaskTable
            rows={rows}
            title={isMine ? "내 업무" : "업무 목록"}
            sub={`${rows.length}건`}
            emptyScope="full"
            emptyText="아직 업무가 없어요"
            emptyHint="상단 필터를 조정하거나, 새 업무를 만들어 시작하세요."
            emptyAction={
              <button className="btn small primary" onClick={quickNew}>
                ＋ 새 업무
              </button>
            }
            variant="full"
            quickComplete
            onStatusChange={changeStatus}
            onRowClick={(id) => openTaskPanel(id)}
          />
        )}
        {!loading && !error && lens === "board" && (
          <TaskBoard
            tasks={filteredTasks}
            today={today}
            group={boardGroup}
            areas={areas}
            actors={actors}
            onMove={moveTask}
          />
        )}
        {!loading && !error && lens === "calendar" && <TaskCalendar tasks={filteredTasks} today={today} />}
        {!loading && !error && lens === "timeline" && <TaskGantt tasks={filteredTasks} today={today} actors={actors} />}

        {/* 완료를 감춘 이유와 되돌리는 길을 목록 아래에 남긴다 (§E) */}
        {!showDone && hiddenDone > 0 && (
          <p className="tv-hidden">
            완료 {hiddenDone}건 숨김 ·{" "}
            <button className="lk" onClick={() => toggleDone(true)}>완료 포함해서 보기</button>
          </p>
        )}
      </div>
      </div>
    </PageShell>
  );
}
