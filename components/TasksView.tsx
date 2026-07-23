"use client";

// 업무 화면 (Phase 5) — 인박스(부사수 제안) + 필터 목록 + 상세 편집.
// 목록 테이블은 홈 "마감 임박"과 동일한 TaskTable을 재사용한다 (검수 포인트 6).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import TaskTable, { type TaskTableRow } from "./TaskTable";

interface TaskItem {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  origin: string;
  projectId: number | null;
  projectName: string | null;
  colorKey: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  goalIds: number[];
  createdByName: string | null;
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

function dday(due: string | null, today: string): { text: string | null; overdue: boolean } {
  if (!due) return { text: null, overdue: false };
  const diff = Math.round(
    (new Date(`${due}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000
  );
  return {
    text: diff < 0 ? `D+${-diff}` : diff === 0 ? "D-DAY" : `D-${diff}`,
    overdue: diff < 0,
  };
}

/** 업무 상세 — 속성 편집 + 목표 연결(다중 선택 · 선택 사항) + 소프트 삭제 */
function TaskDetail({
  task,
  actors,
  projects,
  monthGoals,
  onChanged,
  onClose,
}: {
  task: TaskItem;
  actors: Option[];
  projects: { id: number; name: string; colorKey: string | null }[];
  monthGoals: MonthGoalOption[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [projectId, setProjectId] = useState(task.projectId ?? 0);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? 0);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [goalIds, setGoalIds] = useState<number[]>(task.goalIds);
  const [dropReason, setDropReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
    setPriority(task.priority);
    setProjectId(task.projectId ?? 0);
    setAssigneeId(task.assigneeId ?? 0);
    setDueDate(task.dueDate ?? "");
    setGoalIds(task.goalIds);
    setConfirmingDelete(false);
    setError("");
  }, [task]);

  async function save() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        status,
        priority,
        projectId: projectId || null,
        assigneeId: assigneeId || null,
        dueDate: dueDate || null,
        goalIds, // 다중 선택 · 선택 사항 (빈 배열 허용)
        dropReason: status === "dropped" ? dropReason : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "저장 실패");
      return;
    }
    onChanged();
  }

  async function softDelete() {
    setBusy(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "삭제 실패");
      return;
    }
    onClose();
    onChanged();
  }

  return (
    <section className="card tdetail" aria-label="업무 상세">
      <div className="ch">
        <h2>업무 상세</h2>
        <span className="sub">#{task.id}{task.origin === "agent" ? " · 부사수 제안" : ""}</span>
        <span className="gsp" />
        <button className="lk mu" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="tform">
        <div className="tform-r">
          <label>제목</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="tform-r">
          <label>설명</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="tform-grid">
          <div className="tform-r">
            <label>상태</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.filter(([v]) => v).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="tform-r">
            <label>우선순위</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="high">높음</option>
              <option value="mid">보통</option>
              <option value="low">낮음</option>
            </select>
          </div>
          <div className="tform-r">
            <label>프로젝트</label>
            <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value={0}>없음</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="tform-r">
            <label>담당</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(Number(e.target.value))}>
              <option value={0}>미지정</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="tform-r">
            <label>기한</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        {status === "dropped" && task.status !== "dropped" && (
          <div className="tform-r">
            <label>중단 사유 (필수)</label>
            <input
              placeholder="왜 중단하나요? 목표 진척 분모에서 제외됩니다."
              value={dropReason}
              onChange={(e) => setDropReason(e.target.value)}
            />
          </div>
        )}
        <div className="tform-r">
          <label>목표 연결 (다중 선택 · 선택 사항)</label>
        </div>
        <div className="glinks">
          {monthGoals.length === 0 && <p className="gempty">연결 가능한 월 목표가 없습니다.</p>}
          {monthGoals.map((goal) => (
            <label key={goal.id} className="glink">
              <input
                type="checkbox"
                checked={goalIds.includes(goal.id)}
                onChange={(e) =>
                  setGoalIds((prev) =>
                    e.target.checked ? [...prev, goal.id] : prev.filter((id) => id !== goal.id)
                  )
                }
              />
              {goal.title}
              <em>{goal.month}</em>
            </label>
          ))}
        </div>
        {error && <p className="gerr">{error}</p>}
        <div className="tform-a">
          <button className="gbtn" onClick={save} disabled={busy || !title.trim()}>
            저장
          </button>
          <span className="gsp" />
          {!confirmingDelete ? (
            <button className="gbtn mu" onClick={() => setConfirmingDelete(true)} disabled={busy}>
              삭제
            </button>
          ) : (
            <>
              <span className="tdel-q">“{task.title}” 업무를 삭제할까요?</span>
              <button className="gbtn" autoFocus onClick={() => setConfirmingDelete(false)}>
                취소
              </button>
              <button className="gbtn danger" onClick={softDelete} disabled={busy}>
                삭제
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** 새 업무 폼 */
function NewTaskForm({
  actors,
  projects,
  user,
  onDone,
}: {
  actors: Option[];
  projects: { id: number; name: string; colorKey: string | null }[];
  user: SessionUser;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(0);
  const [assigneeId, setAssigneeId] = useState(user.id);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("mid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        projectId: projectId || null,
        assigneeId: assigneeId || null,
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
      <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
        <option value={0}>프로젝트 없음</option>
        {projects.map((p) => (
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
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
  const [projects, setProjects] = useState<{ id: number; name: string; colorKey: string | null }[]>([]);
  const [monthGoals, setMonthGoals] = useState<MonthGoalOption[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // 필터 (프로젝트 · 담당 · 상태 · 기한)
  const [fProject, setFProject] = useState("");
  const [fAssignee, setFAssignee] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDue, setFDue] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
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
  }, [fProject, fAssignee, fStatus, fDue]);

  // 셀렉트 룩업은 목록과 분리된 /api/meta/selectors에서 (Phase 8 D-3)
  const loadSelectors = useCallback(async () => {
    const res = await fetch("/api/meta/selectors");
    const data = await res.json();
    if (res.ok) {
      setActors(data.actors ?? []);
      setProjects(data.projects ?? []);
      setMonthGoals(data.monthGoals ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSelectors();
  }, [loadSelectors]);

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

  const rows: TaskTableRow[] = useMemo(
    () =>
      tasks.map((t) => {
        const d = dday(t.dueDate, today);
        return {
          id: t.id,
          title: t.title,
          projectName: t.projectName,
          colorKey: t.colorKey,
          assigneeName: t.assigneeName,
          status: t.status,
          dday: d.text,
          overdue: d.overdue && t.status !== "done" && t.status !== "dropped",
        };
      }),
    [tasks, today]
  );

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

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
            <h1>업무</h1>
            <p>부사수 제안은 인박스에서 승인해야 목록·홈·캘린더에 반영됩니다.</p>
          </div>
        </div>

        {/* 인박스 — status='proposed' 전용 노출 위치 (홈·캘린더·타임라인 제외) */}
        {inbox.length > 0 && (
          <section className="card tinbox" aria-label="인박스">
            <div className="ch">
              <h2>인박스</h2>
              <span className="sub">부사수 제안 {inbox.length}건 — 승인 시 업무로 전환</span>
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

        <div className="tfilters">
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

        {loading && <p className="gempty">불러오는 중...</p>}
        {error && <p className="gerr">{error}</p>}
        {!loading && (
          <TaskTable
            rows={rows}
            title="업무 목록"
            sub={`${rows.length}건`}
            emptyText="조건에 맞는 업무가 없습니다."
            onRowClick={(id) => setSelectedId((prev) => (prev === id ? null : id))}
            selectedId={selectedId}
          />
        )}

        {selected && (
          <TaskDetail
            task={selected}
            actors={actors}
            projects={projects}
            monthGoals={monthGoals}
            onChanged={load}
            onClose={() => setSelectedId(null)}
          />
        )}

        <NewTaskForm actors={actors} projects={projects} user={user} onDone={load} />
      </div>
    </div>
  );
}
