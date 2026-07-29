"use client";

// 업무 화면 (Phase 5) — 인박스(에이전트 제안) + 필터 목록 + 상세 편집.
// 목록 테이블은 홈 "마감 임박"과 동일한 TaskTable을 재사용한다 (검수 포인트 6).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import TaskTable, { type TaskTableRow } from "./TaskTable";
import TaskBoard from "./TaskBoard";
import TaskCalendar from "./TaskCalendar";
import TaskGantt from "./TaskGantt";
import { toast } from "@/lib/quick";
import {
  type TaskItem, type TaskLens, type BoardGroup, LENS_LABEL, GROUP_LABEL, dday,
} from "@/lib/task-view";
import { openNewTaskPanel, openTaskPanel, TASK_UPDATED_EVENT } from "@/lib/task-panel";

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

/** 새 업무 폼 — 영역(필수, 최상단) → 업무유형 → 프로젝트(선택 영역 하위만) */
function NewTaskForm({
  actors,
  projects,
  areas,
  myAreaIds,
  user,
  onDone,
}: {
  actors: Option[];
  projects: ProjectOption[];
  areas: AreaOption[];
  myAreaIds: number[];
  user: SessionUser;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  // 담당자의 기본 영역 첫 항목을 기본값으로
  const [areaId, setAreaId] = useState<number>(myAreaIds[0] ?? areas[0]?.id ?? 0);
  const [workType, setWorkType] = useState("team");
  const [projectId, setProjectId] = useState(0);
  const [assigneeId, setAssigneeId] = useState(user.id);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("mid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 선택 영역의 하위 프로젝트만 노출. 영역이 바뀌면 소속 아닌 프로젝트는 해제.
  const areaProjects = projects.filter((p) => p.areaId === areaId);
  useEffect(() => {
    if (projectId && !areaProjects.some((p) => p.id === projectId)) setProjectId(0);
  }, [areaId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!title.trim()) return;
    if (!areaId) {
      setError("업무 영역을 선택하세요.");
      return;
    }
    if (startDate && dueDate && startDate > dueDate) {
      setError("시작일이 마감일보다 늦을 수 없습니다.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        areaId,
        workType,
        projectId: projectId || null,
        assigneeId: assigneeId || null,
        startDate: startDate || null,
        dueDate: dueDate || null,
        priority,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "생성 실패");
      return;
    }
    setTitle("");
    setStartDate("");
    setDueDate("");
    onDone();
  }

  return (
    <div className="tnew">
      <input
        placeholder="새 업무 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <select aria-label="영역" value={areaId} onChange={(e) => setAreaId(Number(e.target.value))}>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select aria-label="업무유형" value={workType} onChange={(e) => setWorkType(e.target.value)}>
        <option value="team">팀업무</option>
        <option value="personal">개인업무</option>
        <option value="routine">상시업무</option>
      </select>
      <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
        <option value={0}>프로젝트 없음</option>
        {areaProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={assigneeId} onChange={(e) => setAssigneeId(Number(e.target.value))}>
        {actors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input type="date" aria-label="시작일" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <input type="date" aria-label="마감일" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      <select value={priority} onChange={(e) => setPriority(e.target.value)}>
        <option value="high">높음</option>
        <option value="mid">보통</option>
        <option value="low">낮음</option>
      </select>
      <button className="lk" onClick={submit} disabled={busy || !title.trim()}>
        추가
      </button>
      {error && <span className="gerr">{error}</span>}
    </div>
  );
}

export default function TasksView({ user }: { user: SessionUser }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [actors, setActors] = useState<Option[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [myAreaIds, setMyAreaIds] = useState<number[]>([]);
  const [monthGoals, setMonthGoals] = useState<MonthGoalOption[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");

  // 필터 (영역 · 프로젝트 · 담당 · 상태 · 기한). 담당 기본값=본인 → "내 업무" 진입.
  const [fArea, setFArea] = useState("");
  const [fProject, setFProject] = useState("");
  const [fAssignee, setFAssignee] = useState(String(user.id));
  const [fStatus, setFStatus] = useState("");
  const [fDue, setFDue] = useState("");
  const [areaDefaulted, setAreaDefaulted] = useState(false);
  const isMine = fAssignee === String(user.id);

  // 뷰(렌즈) 전환 — 마지막 뷰·그룹 기준 기억(localStorage)
  const [lens, setLens] = useState<TaskLens>("sheet");
  const [boardGroup, setBoardGroup] = useState<BoardGroup>("status");
  useEffect(() => {
    const v = localStorage.getItem("tb:tasks-lens") as TaskLens | null;
    if (v && ["sheet", "board", "calendar", "timeline"].includes(v)) setLens(v);
    const g = localStorage.getItem("tb:tasks-group") as BoardGroup | null;
    if (g && ["status", "area", "assignee"].includes(g)) setBoardGroup(g);
  }, []);
  function pickLens(v: TaskLens) { setLens(v); localStorage.setItem("tb:tasks-lens", v); }
  function pickGroup(g: BoardGroup) { setBoardGroup(g); localStorage.setItem("tb:tasks-group", g); }

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (fArea) qs.set("area", fArea);
      if (fProject) qs.set("project", fProject);
      if (fAssignee) qs.set("assignee", fAssignee);
      if (fStatus) qs.set("status", fStatus);
      if (fDue) qs.set("due", fDue);
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
  }, [fArea, fProject, fAssignee, fStatus, fDue]);

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
    }
  }, []);

  // 홈 KPI 카드 링크 진입 — ?status·?due 반영 + 팀 전체 범위(담당·영역 전체)로.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const st = sp.get("status");
    const du = sp.get("due");
    if (st || du) {
      if (st) setFStatus(st);
      if (du) setFDue(du);
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
      setFArea(urlArea);
      setAreaDefaulted(true);
    } else if (myAreaIds.length > 0) {
      setFArea(String(myAreaIds[0]));
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

  const goalTitleOf = useCallback(
    (id: number) => monthGoals.find((g) => g.id === id)?.title,
    [monthGoals]
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

  // 검색 적용된 업무 목록 — 모든 렌즈가 공유
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        !q ||
        t.title.toLowerCase().includes(q) ||
        (t.projectName ?? "").toLowerCase().includes(q) ||
        (t.assigneeName ?? "").toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const rows: TaskTableRow[] = useMemo(() => {
    return filteredTasks
      .map((t) => {
        const d = dday(t.dueDate, today);
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
        };
      });
  }, [filteredTasks, today, goalTitleOf]);

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>업무</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">TASKS</div>
            <h1>{isMine ? "내 업무" : "업무"}</h1>
            <p>
              {isMine
                ? "담당이 나인 업무만 보고 있습니다. 담당을 ‘전체 담당’으로 바꾸면 전체를 조회합니다."
                : "에이전트 제안은 인박스에서 승인해야 목록·홈·캘린더에 반영됩니다."}
            </p>
          </div>
          {/* 홈 "+ 새로 만들기"와 동일 규칙 — 제목 줄 우측 상단 고정 (필터 줄바꿈과 무관) */}
          <button className="newbtn" onClick={() => setShowNew((s) => !s)}>
            ＋ 새 업무
          </button>
        </div>

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

        {/* 필터 — 한 줄 인라인: 검색 + 셀렉트 + 우측 새 업무 버튼 */}
        <div className="tfilters">
          <input
            className="tsearch"
            placeholder="업무·프로젝트·담당 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={fArea} onChange={(e) => { setFArea(e.target.value); setAreaDefaulted(true); }}>
            <option value="">전체 영역</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select value={fProject} onChange={(e) => setFProject(e.target.value)}>
            <option value="">전체 프로젝트</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)}>
            <option value="">전체 담당</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            {STATUS_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select value={fDue} onChange={(e) => setFDue(e.target.value)}>
            {DUE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {showNew && (
          <NewTaskForm
            actors={actors}
            projects={projects}
            areas={areas}
            myAreaIds={myAreaIds}
            user={user}
            onDone={() => { setShowNew(false); load(); }}
          />
        )}

        {/* 뷰 전환 — 같은 데이터, 다른 렌즈. 보드는 그룹 기준(상태/영역/담당) 선택. */}
        <div className="lens-bar">
          <div className="lens-tabs" role="tablist" aria-label="업무 뷰">
            {(["sheet", "board", "calendar", "timeline"] as TaskLens[]).map((v) => (
              <button key={v} role="tab" aria-selected={lens === v} className="lens-tab" onClick={() => pickLens(v)}>
                {LENS_LABEL[v]}
              </button>
            ))}
          </div>
          {lens === "board" && (
            <div className="lens-group" role="group" aria-label="그룹 기준">
              <span className="lens-group-l">그룹</span>
              {(["status", "area", "assignee"] as BoardGroup[]).map((g) => (
                <button key={g} className="lens-gbtn" aria-pressed={boardGroup === g} onClick={() => pickGroup(g)}>
                  {GROUP_LABEL[g]}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading && <p className="gempty">불러오는 중...</p>}
        {error && <p className="gerr">{error}</p>}
        {!loading && lens === "sheet" && (
          <TaskTable
            rows={rows}
            title={isMine ? "내 업무" : "업무 목록"}
            sub={`${rows.length}건`}
            emptyText="아직 업무가 없어요"
            emptyHint="상단 필터를 조정하거나, 새 업무를 만들어 시작하세요."
            emptyAction={
              <button className="btn small primary" onClick={() => openNewTaskPanel()}>
                ＋ 새 업무
              </button>
            }
            variant="full"
            quickComplete
            onStatusChange={changeStatus}
            onRowClick={(id) => openTaskPanel(id)}
          />
        )}
        {!loading && lens === "board" && (
          <TaskBoard
            tasks={filteredTasks}
            today={today}
            group={boardGroup}
            areas={areas}
            actors={actors}
            onMove={moveTask}
          />
        )}
        {!loading && lens === "calendar" && <TaskCalendar tasks={filteredTasks} today={today} />}
        {!loading && lens === "timeline" && <TaskGantt tasks={filteredTasks} today={today} actors={actors} />}
      </div>
    </div>
  );
}
