"use client";

// 프로젝트 상세 (Phase 5) — 개요 · 목표 · 업무 · 자료 4탭.
// 자료는 {kind, title, url} 링크 카드만 — 본문을 가져오지 않는다 (검수 포인트 3).
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import TaskTable, { type TaskTableRow } from "./TaskTable";
import GoalProgress from "./GoalProgress";

interface Detail {
  project: {
    id: number;
    name: string;
    status: string;
    colorKey: string | null;
    startDate: string | null;
    endDate: string | null;
    notionUrl: string | null;
  };
  goals: { id: number; title: string; periodType: string; periodStart: string; progress: number | null }[];
  tasks: {
    id: number;
    title: string;
    status: string;
    priority: string;
    assigneeName: string | null;
    dueDate: string | null;
  }[];
  artifacts: { id: number; kind: string; title: string; url: string; created_at: string }[];
  today: string;
}

const TABS = [
  ["overview", "개요"],
  ["goals", "목표"],
  ["tasks", "업무"],
  ["artifacts", "자료"],
] as const;

const STATUS_LABEL: Record<string, string> = { active: "진행중", done: "완료", hold: "보류" };
const PERIOD_LABEL: Record<string, string> = { year: "연간", quarter: "분기", month: "월" };
const KIND_LABEL: Record<string, string> = {
  notion: "Notion",
  github: "GitHub",
  figma: "Figma",
  file: "파일",
  link: "링크",
};

function dday(due: string | null, today: string): { text: string | null; overdue: boolean } {
  if (!due) return { text: null, overdue: false };
  const diff = Math.round(
    (new Date(`${due}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000
  );
  return { text: diff < 0 ? `D+${-diff}` : diff === 0 ? "D-DAY" : `D-${diff}`, overdue: diff < 0 };
}

function AddArtifactForm({ projectId, onDone }: { projectId: number; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim() || !url.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title, url }), // kind는 URL에서 자동 추정
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "추가 실패");
      return;
    }
    setTitle("");
    setUrl("");
    onDone();
  }

  return (
    <div className="tnew">
      <input placeholder="자료 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input
        placeholder="https:// 링크"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        style={{ minWidth: 260 }}
      />
      <button className="lk" onClick={submit} disabled={busy || !title.trim() || !url.trim()}>
        링크 추가
      </button>
      {error && <span className="gerr">{error}</span>}
    </div>
  );
}

export default function ProjectDetailView({
  user,
  projectId,
}: {
  user: SessionUser;
  projectId: number;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "프로젝트 조회 실패");
      setDetail(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(status: string) {
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "변경 실패");
      return;
    }
    load();
  }

  async function removeArtifact(id: number) {
    const res = await fetch(`/api/artifacts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    if (res.ok) load();
  }

  if (error) {
    return (
      <div className="hv">
        <div className="wrap">
          <p className="gerr">{error}</p>
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="hv">
        <div className="wrap">
          <p className="gempty">불러오는 중...</p>
        </div>
      </div>
    );
  }

  const { project, goals, tasks, artifacts, today } = detail;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const openCount = tasks.filter((t) => ["todo", "doing", "review"].includes(t.status)).length;
  const totalForPercent = tasks.filter((t) => t.status !== "dropped").length;
  const percent = totalForPercent > 0 ? Math.round((doneCount / totalForPercent) * 100) : null;

  const taskRows: TaskTableRow[] = tasks.map((t) => {
    const d = dday(t.dueDate, today);
    return {
      id: t.id,
      title: t.title,
      projectName: project.name,
      colorKey: project.colorKey,
      assigneeName: t.assigneeName,
      status: t.status,
      dday: d.text,
      overdue: d.overdue && t.status !== "done" && t.status !== "dropped",
    };
  });

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / 전체 프로젝트 / <b>{project.name}</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">PROJECT</div>
            <h1>
              <span className="pj">
                <i className={project.colorKey ?? "team"} />
                {project.name}
              </span>
            </h1>
            <p>
              {STATUS_LABEL[project.status] ?? project.status}
              {project.startDate ? ` · ${project.startDate} ~ ${project.endDate ?? ""}` : ""}
            </p>
          </div>
          <div className="seg" role="group" aria-label="탭">
            {TABS.map(([value, label]) => (
              <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === "overview" && (
          <section className="card">
            <div className="ch">
              <h2>개요</h2>
            </div>
            <div className="pover">
              <div className="pover-r">
                <label>진행률</label>
                <div className="pcard-bar">
                  <div className="bar">
                    <i className={project.colorKey ?? "team"} style={{ width: `${percent ?? 0}%` }} />
                  </div>
                  <span className="gpv">
                    {percent === null ? "-" : `${percent}%`}
                    {totalForPercent > 0 && <em>{doneCount}/{totalForPercent}</em>}
                  </span>
                </div>
              </div>
              <div className="pover-r">
                <label>요약</label>
                <span>
                  목표 {goals.length} · 열린 업무 {openCount} · 자료 {artifacts.length}
                </span>
              </div>
              {project.notionUrl && (
                <div className="pover-r">
                  <label>Notion</label>
                  <a href={project.notionUrl} target="_blank" rel="noreferrer" className="lk">
                    {project.notionUrl}
                  </a>
                </div>
              )}
              {user.role === "lead" && (
                <div className="pover-r">
                  <label>상태 변경</label>
                  <div className="seg">
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={project.status === value}
                        disabled={busy}
                        onClick={() => setStatus(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "goals" && (
          <section className="card">
            <div className="ch">
              <h2>연결된 목표</h2>
              <span className="sub">{goals.length}건 — 진척은 목표 화면 계산값</span>
            </div>
            {goals.length === 0 && <p className="gempty">이 프로젝트에 연결된 목표가 없습니다.</p>}
            {goals.map((goal) => (
              <div key={goal.id} className="garchive-row">
                <span className="gtag">{PERIOD_LABEL[goal.periodType] ?? goal.periodType}</span>
                <span className="gtitle">{goal.title}</span>
                <em className="garchive-p">{goal.periodStart.slice(0, 7)}</em>
                <span className="gsp" />
                <GoalProgress progress={goal.progress} colorKey={project.colorKey} />
              </div>
            ))}
          </section>
        )}

        {tab === "tasks" && (
          <TaskTable
            rows={taskRows}
            title="프로젝트 업무"
            sub={`${taskRows.length}건`}
            emptyText="이 프로젝트의 업무가 없습니다."
          />
        )}

        {tab === "artifacts" && (
          <section className="card">
            <div className="ch">
              <h2>자료</h2>
              <span className="sub">링크 카드 — 본문은 저장하지 않습니다</span>
            </div>
            {artifacts.length === 0 && <p className="gempty">등록된 자료가 없습니다.</p>}
            <div className="acards">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="acard">
                  <span className={`akind ${artifact.kind}`}>{KIND_LABEL[artifact.kind] ?? artifact.kind}</span>
                  <a href={artifact.url} target="_blank" rel="noreferrer" className="acard-t">
                    {artifact.title}
                  </a>
                  <em className="acard-u">{artifact.url}</em>
                  <span className="gsp" />
                  <button className="lk mu" onClick={() => removeArtifact(artifact.id)}>
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <AddArtifactForm projectId={project.id} onDone={load} />
          </section>
        )}
      </div>
    </div>
  );
}
