"use client";

// 프로젝트 워크스페이스 (MD-P-2026-005) — 헤더 + 5탭 + 우측 슬라이드인 패널.
// 논의·업무·캔버스·결정이 한 곳에서 끝난다. 탭은 리로드 없이 전환하고 URL ?tab=에 반영(공유 가능).
// 우측 패널 규칙(§B3): 논의 스레드·멤버 프로필이 같은 자리에서 열리고, 좌측 목록은 계속 조작 가능.
import { useCallback, useEffect, useMemo, useState } from "react";
import { countedLabel } from "@/lib/progress";
import Link from "next/link";
import type { SessionUser } from "@/lib/types";
import type { TaskItem } from "@/lib/task-view";
import TaskTable, { type TaskTableRow } from "./TaskTable";
import TaskBoard from "./TaskBoard";
import PageShell from "./PageShell";
import ProjectCanvas from "./ProjectCanvas";
import DecisionLog from "./DecisionLog";
import EmptyState from "./EmptyState";
import ResourceLinks from "./ResourceLinks";
import { openTaskPanel, TASK_UPDATED_EVENT } from "@/lib/task-panel";
import { SIDE_PANEL_EVENT, currentPanel, openPanel } from "@/lib/side-panel";
import { SIGNAL_CHANGED_EVENT } from "@/lib/collab-events";
import { openQuickCreate, toast } from "@/lib/quick";
import { dday } from "@/lib/task-view";

const TABS = [
  ["overview", "개요"],
  ["tasks", "업무"],
  ["discussions", "논의"],
  ["canvas", "캔버스"],
  ["decisions", "결정 로그"],
] as const;
type Tab = (typeof TABS)[number][0];

const STATUS_LABEL: Record<string, string> = { active: "진행", hold: "보류", done: "완료", archived: "보관" };
const STATUS_TONE: Record<string, string> = { active: "var(--blue)", hold: "var(--amber)", done: "var(--green)", archived: "var(--slate)" };

interface Member { id: number; name: string; avatarUrl: string | null }
interface Discussion { id: number; type: string; title: string; status: string; authorName: string; ageDays: number; commentCount: number; open: boolean }
interface WorkspaceData {
  project: {
    id: number; name: string; status: string; colorKey: string | null;
    startDate: string | null; endDate: string | null; notionUrl: string | null;
    areaId: number | null; areaName: string | null; areaColor: string | null;
    archivedAt: string | null; ownerId: number | null; ownerName: string | null;
    progress: number | null;
    countedTasks: number;
    goal: { id: number; title: string; periodType: string; periodStart: string; progress: number | null; manual: boolean } | null;
  };
  members: Member[];
  tasks: { id: number; title: string; status: string; dueDate: string | null }[];
  discussions: Discussion[];
  openDiscussions: number;
  decisions: unknown[];
  upcoming: { id: number; title: string; dueDate: string | null; assigneeName: string | null }[];
  activity: { id: number; message: string; created_at: string; user_name: string | null }[];
  today: string;
  canEdit: boolean;
}

function goalLabel(g: NonNullable<WorkspaceData["project"]["goal"]>): string {
  const y = g.periodStart?.slice(0, 4) ?? "";
  const q = g.periodType === "quarter" ? ` Q${Math.floor((Number(g.periodStart?.slice(5, 7) ?? 1) - 1) / 3) + 1}`
    : g.periodType === "month" ? ` ${Number(g.periodStart?.slice(5, 7) ?? 1)}월` : "";
  return `${y}${q} · ${g.title}`;
}

export default function ProjectWorkspace({ projectId, user }: { projectId: number; user: SessionUser }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [taskView, setTaskView] = useState<"table" | "board">("table");
  const [fullTasks, setFullTasks] = useState<TaskItem[]>([]);
  // 우측 패널은 전역 컴포넌트가 그린다 (MD-P-2026-006 §B). 여기서는 열림 여부만 따라간다.
  const [panel, setPanel] = useState<{ kind: string; id: number } | null>(null);
  const [more, setMore] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [goalPick, setGoalPick] = useState(false);
  const [goals, setGoals] = useState<{ id: number; title: string; level: string; period: string; scope: string }[]>([]);
  const [linkCount, setLinkCount] = useState(0);

  // URL ?tab= 반영 (공유 가능) — 초기 진입 시 읽고, 전환 시 replaceState
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && TABS.some(([v]) => v === t)) setTab(t);
  }, []);
  function pickTab(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState({}, "", url);
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/workspace`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "프로젝트를 불러올 수 없습니다.");
      setData(d); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    }
  }, [projectId]);
  const loadTasks = useCallback(async () => {
    const res = await fetch(`/api/tasks?project=${projectId}`);
    if (res.ok) setFullTasks((await res.json()).tasks ?? []);
  }, [projectId]);

  // 연결 리소스 수 (§E) — 개요 탭 헤더에 표시
  const loadLinkCount = useCallback(async () => {
    const res = await fetch(`/api/links?entityType=project&entityId=${projectId}&skipRefresh=1`).catch(() => null);
    if (res && res.ok) setLinkCount(((await res.json()).links ?? []).length);
  }, [projectId]);

  useEffect(() => { load(); loadTasks(); loadLinkCount(); }, [load, loadTasks, loadLinkCount]);
  useEffect(() => {
    const on = () => { load(); loadTasks(); };
    window.addEventListener(TASK_UPDATED_EVENT, on);
    return () => window.removeEventListener(TASK_UPDATED_EVENT, on);
  }, [load, loadTasks]);
  useEffect(() => {
    if (!goalPick) return;
    // 연간·분기·월 전부 후보 (§B2) — 월 목표만 뜨던 문제 수정
    fetch("/api/meta/selectors").then((r) => r.json()).then((d) => setGoals(d.linkGoals ?? [])).catch(() => {});
  }, [goalPick]);
  // 전역 패널 상태 추종 (Esc·URL·뒤로가기는 전역 규칙이 처리)
  useEffect(() => {
    const sync = () => setPanel(currentPanel());
    sync();
    window.addEventListener(SIDE_PANEL_EVENT, sync);
    window.addEventListener("popstate", sync);
    window.addEventListener(SIGNAL_CHANGED_EVENT, load);
    return () => {
      window.removeEventListener(SIDE_PANEL_EVENT, sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener(SIGNAL_CHANGED_EVENT, load);
    };
  }, [load]);

  const archived = data?.project.status === "archived";
  const readOnly = archived || !data?.canEdit;

  async function patchProject(fields: Record<string, unknown>, okMsg?: string) {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    }).catch(() => null);
    if (!res || !res.ok) {
      toast((res && (await res.json().catch(() => ({})))?.error) || "변경에 실패했어요", "err");
      await load();
      return false;
    }
    if (okMsg) toast(okMsg);
    await load();
    return true;
  }

  const rows: TaskTableRow[] = useMemo(() => fullTasks.map((t) => {
    const d = dday(t.dueDate, data?.today ?? "");
    return {
      id: t.id, title: t.title, projectName: t.projectName, colorKey: t.colorKey,
      assigneeName: t.assigneeName, status: t.status, dday: d.text, overdue: d.overdue,
      priority: t.priority, areaName: t.areaName, progress: t.progress,
      blocked: t.blocked, blockedReason: t.blockedReason,
    };
  }), [fullTasks, data?.today]);

  if (error) return <div className="hv"><div className="wrap"><p className="gerr">{error}</p></div></div>;
  if (!data) return <div className="hv"><div className="wrap"><p className="gempty">불러오는 중...</p></div></div>;
  const p = data.project;

  return (
    <PageShell
      crumb={["워크스페이스", "프로젝트", p.name]}
      title={
        renaming && !readOnly ? (
          <input className="pws-title-in" defaultValue={p.name} autoFocus
            onBlur={async (e) => { const v = e.target.value.trim(); setRenaming(false); if (v && v !== p.name) await patchProject({ name: v }, "이름을 바꿨어요"); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(false); }} />
        ) : (
          <span className="pws-title" onClick={() => !readOnly && setRenaming(true)} title={readOnly ? undefined : "클릭해 이름 편집"}>{p.name}</span>
        )
      }
      subtitle={
        <span className="pws-sub">
          {p.areaName && <span className="pws-chip"><i className={`pjdot ${p.areaColor ?? "team"}`} />{p.areaName}</span>}
          <span className="pws-chip" style={{ color: STATUS_TONE[p.status] }}>{STATUS_LABEL[p.status] ?? p.status}</span>
          {p.goal ? (
            <>
              <Link className="lk pws-goal-l" href={`/goals?goal=${p.goal.id}`}>→ {goalLabel(p.goal)}</Link>
              <span className={`pws-goal-p num${p.goal.progress === null ? " none" : ""}`}>
                {p.goal.progress === null ? "집계 없음" : `${p.goal.progress}%`}
              </span>
              {p.goal.manual && <span className="pws-manual">수동</span>}
            </>
          ) : !readOnly ? (
            <span className="pws-goal-pick">
              <button className="lk" onClick={() => setGoalPick((v) => !v)}>＋ 목표 연결</button>
              {goalPick && (
                <span className="pws-goal-menu" role="menu">
                  {goals.length === 0 && <span className="pws-goal-none">연결할 목표가 없어요.</span>}
                  {goals.map((g) => (
                    <button key={g.id} onClick={async () => { setGoalPick(false); await patchProject({ goalId: g.id }, "목표를 연결했어요"); }}>
                      <span className="pws-goal-lv">{g.level}</span>{g.title}
                      <em>{g.period}{g.scope === "personal" ? " · 개인" : ""}</em>
                    </button>
                  ))}
                </span>
              )}
            </span>
          ) : <span className="pws-goal-none">연결된 목표 없음</span>}
        </span>
      }
      actions={
        <>
          <span className="pws-members">
            {data.members.slice(0, 5).map((m) => (
              <button key={m.id} className="pws-av" title={m.name} onClick={() => openPanel("member", m.id)}>{m.name.slice(0, 1)}</button>
            ))}
            {data.members.length > 5 && <span className="pws-av more">+{data.members.length - 5}</span>}
            {data.members.length === 0 && <span className="pws-goal-none">멤버 없음</span>}
          </span>
          <span className="pws-more-wrap">
            <button className="btn-ghost" aria-label="더보기" aria-expanded={more} onClick={() => setMore((v) => !v)}>⋯</button>
            {more && (
              <span className="pws-more-menu" role="menu">
                {p.notionUrl && <a href={p.notionUrl} target="_blank" rel="noreferrer">Notion에서 열기 ↗</a>}
                {data.canEdit && !archived && <button onClick={() => { setMore(false); setArchiving(true); }}>보관…</button>}
                {!data.canEdit && <span className="pws-goal-none">권한 없음</span>}
              </span>
            )}
          </span>
          {!readOnly && (
            <button className="btn-primary" onClick={(e) => openQuickCreate({ x: e.clientX - 300, y: e.clientY + 10 }, { areaId: p.areaId ?? undefined })}>
              ＋ 업무
            </button>
          )}
        </>
      }
      tabs={TABS.map(([v, label]) => ({
        key: v,
        label,
        count: v === "discussions" ? data.openDiscussions : undefined,
      }))}
      activeTab={tab}
      onTab={(k) => pickTab(k as Tab)}
    >
      {archived && (
        <div className="pws-arch" role="status">
          보관된 프로젝트입니다 · 읽기 전용
          {data.canEdit && (
            <button className="lk" onClick={() => patchProject({ status: "active" }, "보관을 해제했어요")}>보관 해제</button>
          )}
        </div>
      )}

        {/* ── 개요 ── */}
        {tab === "overview" && (
          <div className="pws-ov">
            <section className="card pws-ov-card">
              <div className="pws-ov-h">진척 롤업</div>
              <div className="pws-prog">
                <div className="pws-prog-track"><i style={{ width: `${Math.max(p.progress ?? 0, 2)}%` }} /></div>
                <span className="pws-prog-v num">{p.progress === null ? "집계 없음" : `${p.progress}%`}</span>
              </div>
              {/* 진척 근거 — 분모를 그대로 보여준다. 기간 가중은 폐지됐다 (MD-P-2026-024 회신 ③) */}
              <p className="pws-ov-sub">{countedLabel(p.countedTasks)}</p>
            </section>

            <section className="card pws-ov-card">
              <div className="pws-ov-h">다가오는 마감 <span className="num">{data.upcoming.length}</span></div>
              {data.upcoming.length === 0 ? <p className="pws-ov-none">예정된 마감이 없어요.</p> : (
                <ul className="pws-list">
                  {data.upcoming.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => openTaskPanel(t.id)}>{t.title}</button>
                      <span className="num">{t.dueDate?.slice(5)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card pws-ov-card">
              <div className="pws-ov-h">미해결 논의 <span className="num">{data.openDiscussions}</span></div>
              {data.openDiscussions === 0 ? <p className="pws-ov-none">미해결 논의가 없어요.</p> : (
                <ul className="pws-list">
                  {data.discussions.filter((d) => d.open).slice(0, 3).map((d) => (
                    <li key={d.id}>
                      <button onClick={() => { pickTab("discussions"); openPanel("signal", d.id); }}>{d.title}</button>
                      <span className={`num${d.ageDays > 14 ? " over" : ""}`}>{d.ageDays}일</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card pws-ov-card wide">
              <div className="pws-ov-h">연결된 리소스 <span className="num">{linkCount}</span></div>
              <ResourceLinks entityType="project" entityId={projectId} canCreateDoc
                onChanged={() => loadLinkCount()} />
            </section>

            <section className="card pws-ov-card wide">
              <div className="pws-ov-h">최근 활동</div>
              {data.activity.length === 0 ? <p className="pws-ov-none">기록된 활동이 없어요.</p> : (
                <ul className="pws-act">
                  {data.activity.map((a) => (
                    <li key={a.id}><span className="num">{a.created_at.slice(5, 16).replace("T", " ")}</span>{a.message}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* ── 업무 (테이블 ⇄ 보드) ── */}
        {tab === "tasks" && (
          <>
            <div className="pws-subbar">
              <div className="seg" role="group" aria-label="보기">
                <button aria-pressed={taskView === "table"} onClick={() => setTaskView("table")}>테이블</button>
                <button aria-pressed={taskView === "board"} onClick={() => setTaskView("board")}>보드</button>
              </div>
            </div>
            {taskView === "table" ? (
              <TaskTable rows={rows} title="업무" variant="full"
                emptyText="이 프로젝트에 업무가 없어요"
                emptyHint="＋ 업무로 첫 항목을 추가하세요."
                onRowClick={(id) => openTaskPanel(id)} />
            ) : (
              <TaskBoard tasks={fullTasks} today={data.today} group="status"
                areas={p.areaId ? [{ id: p.areaId, name: p.areaName ?? "", colorKey: p.areaColor }] : []}
                actors={data.members.map((m) => ({ id: m.id, name: m.name }))}
                onMove={async (id, patch) => {
                  setFullTasks((cur) => cur.map((t) => (t.id === id ? { ...t, ...(patch as Partial<TaskItem>) } : t)));
                  const res = await fetch(`/api/tasks/${id}`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
                  }).catch(() => null);
                  if (!res || !res.ok) { toast("이동에 실패해 되돌렸어요", "err"); await loadTasks(); return; }
                  toast("옮겼어요"); await loadTasks(); await load();
                }} />
            )}
          </>
        )}

        {/* ── 논의 ── */}
        {tab === "discussions" && (
          <section className="card pws-disc" aria-label="논의">
            {data.discussions.length === 0 ? (
              <EmptyState icon="chat" title="이 프로젝트의 논의가 없어요" hint="논의·결정에서 프로젝트를 지정하면 여기에 모입니다."
                action={<Link className="btn small" href="/signals">논의·결정으로</Link>} />
            ) : (
              <div className="pws-dlist">
                {data.discussions.map((d) => (
                  <button key={d.id} className={`pws-drow${d.open ? "" : " closed"}${panel?.kind === "signal" && panel.id === d.id ? " sel" : ""}`}
                    onClick={() => openPanel("signal", d.id)}>
                    <span className={`pws-ddot ${d.open ? (d.ageDays > 14 ? "hot" : "open") : "done"}`} />
                    <span className="pws-db">
                      <span className="pws-dt">{d.title}</span>
                      <span className="pws-dm">{d.authorName} · 답글 {d.commentCount}</span>
                    </span>
                    <span className={`pws-dage num${d.open && d.ageDays > 14 ? " over" : ""}`}>{d.ageDays}일</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── 캔버스 ── */}
        {tab === "canvas" && <ProjectCanvas projectId={projectId} readOnly={readOnly} />}

        {/* ── 결정 로그 ── */}
        {tab === "decisions" && <DecisionLog projectId={projectId} />}

      {/* 보관 확인 */}
      {archiving && (
        <div className="dcf-bg" role="presentation" onClick={() => setArchiving(false)}>
          <div className="dcf" style={{ width: "min(420px, 94vw)" }} role="alertdialog" aria-label="프로젝트 보관" onClick={(e) => e.stopPropagation()}>
            <div className="dcf-h"><b>프로젝트를 보관할까요?</b></div>
            <p className="pws-arch-note">
              삭제가 아닙니다. 보관하면 읽기 전용이 되고 사이드바에서 숨겨지지만,
              검색·결정 로그에서는 계속 조회할 수 있습니다.
            </p>
            <div className="dcf-foot">
              <span className="dcf-note" />
              <button className="btn-outline" onClick={() => setArchiving(false)}>취소</button>
              <button className="btn-brand" onClick={async () => { setArchiving(false); await patchProject({ status: "archived" }, "프로젝트를 보관했어요"); }}>보관</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
