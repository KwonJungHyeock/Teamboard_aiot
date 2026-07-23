"use client";

// 목표 트리 (Phase 4) — 연간 > 분기 > 월 3단, <details> 접기.
// 진척 수치는 서버(lib/goals.ts) 계산 결과만 표시한다.
import { useState } from "react";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import GoalProgress from "./GoalProgress";

export interface LinkableTask {
  id: number;
  title: string;
  status: string;
  assignee_name: string | null;
}

const PERIOD_LABEL = { year: "연간", quarter: "분기", month: "월" } as const;

/** 보관 확인 다이얼로그 — 목표 제목 표시, [취소]가 기본 포커스 */
function ArchiveDialog({
  goal,
  onClose,
  onArchived,
}: {
  goal: GoalNode;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function archive() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/goals/${goal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "보관 실패");
      return;
    }
    onClose();
    onArchived();
  }

  return (
    <div className="gdlg-bg" role="presentation" onClick={onClose}>
      <div
        className="gdlg"
        role="alertdialog"
        aria-modal="true"
        aria-label="목표 보관 확인"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h3>목표를 보관할까요?</h3>
        <p className="gdlg-t">“{goal.title}”</p>
        <p className="gdlg-d">
          보관된 목표는 트리와 집계에서 제외됩니다. 연결된 업무는 유지되며, 보관함에서 복구할 수
          있습니다.
        </p>
        {error && <p className="gerr">{error}</p>}
        <div className="gdlg-a">
          <button className="gbtn" autoFocus onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="gbtn danger" onClick={archive} disabled={busy}>
            보관
          </button>
        </div>
      </div>
    </div>
  );
}

/** 연간·분기 목표 편집 패널 — 제목 변경 + (하단) 보관. 트리에는 보관 버튼을 직접 노출하지 않는다. */
function NodeEditPanel({
  goal,
  isLead,
  onChanged,
}: {
  goal: GoalNode;
  isLead: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(goal.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function rename() {
    if (!title.trim() || title.trim() === goal.title) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/goals/${goal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "수정 실패");
      return;
    }
    onChanged();
  }

  return (
    <div className="gedit">
      <div className="gedit-r">
        <label>제목</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ minWidth: 220 }} />
        <button className="lk" onClick={rename} disabled={busy || !title.trim()}>
          저장
        </button>
        {error && <span className="gerr">{error}</span>}
      </div>
      {isLead && (
        <div className="gedit-r garchive-r">
          <button className="gbtn mu" onClick={() => setConfirming(true)} disabled={busy}>
            보관
          </button>
        </div>
      )}
      {confirming && (
        <ArchiveDialog goal={goal} onClose={() => setConfirming(false)} onArchived={onChanged} />
      )}
    </div>
  );
}

function AddGoalForm({
  periodType,
  parent,
  year,
  onDone,
}: {
  periodType: "year" | "quarter" | "month";
  parent: GoalNode | null;
  year: number;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [slot, setSlot] = useState(1); // 분기(1~4) 또는 월(해당 분기 내 1~3번째)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function periods(): { periodStart: string; periodEnd: string } {
    const pad = (n: number) => String(n).padStart(2, "0");
    if (periodType === "year") {
      return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
    }
    if (periodType === "quarter") {
      const startMonth = (slot - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
      return {
        periodStart: `${year}-${pad(startMonth)}-01`,
        periodEnd: `${year}-${pad(endMonth)}-${lastDay}`,
      };
    }
    // month: 상위 분기의 1~3번째 달
    const quarterStart = parent ? Number(parent.periodStart.slice(5, 7)) : 1;
    const month = quarterStart + (slot - 1);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      periodStart: `${year}-${pad(month)}-01`,
      periodEnd: `${year}-${pad(month)}-${lastDay}`,
    };
  }

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    const { periodStart, periodEnd } = periods();
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodType,
        parentId: parent?.id ?? null,
        title,
        periodStart,
        periodEnd,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "생성 실패");
      return;
    }
    setTitle("");
    onDone();
  }

  const quarterStart = parent ? Number(parent.periodStart.slice(5, 7)) : 1;

  return (
    <div className="gadd">
      {periodType === "quarter" && (
        <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
      )}
      {periodType === "month" && (
        <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
          {[0, 1, 2].map((i) => (
            <option key={i} value={i + 1}>
              {quarterStart + i}월
            </option>
          ))}
        </select>
      )}
      <input
        placeholder={`${PERIOD_LABEL[periodType]} 목표 제목`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className="lk" onClick={submit} disabled={busy || !title.trim()}>
        추가
      </button>
      {error && <span className="gerr">{error}</span>}
    </div>
  );
}

function MonthGoalRow({
  goal,
  user,
  linkableTasks,
  onChanged,
}: {
  goal: GoalNode;
  user: SessionUser;
  linkableTasks: LinkableTask[];
  onChanged: () => void;
}) {
  const canEdit = user.role === "lead" || goal.ownerActorId === user.id;
  const [editing, setEditing] = useState(false);
  const [manualValue, setManualValue] = useState(goal.progress ?? 0);
  const [selected, setSelected] = useState<number[]>(goal.tasks.map((t) => t.id));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/goals/${goal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    onChanged();
  }

  const doneCount = goal.tasks.filter((t) => t.status === "done").length;

  return (
    <div className="grow">
      <div className="grow-h">
        <span className="gtag">{goal.periodStart.slice(5, 7)}월</span>
        <span className="gtitle">{goal.title}</span>
        {goal.progressMode === "manual" && <span className="gtag mu">수동</span>}
        <span className="gsp" />
        <GoalProgress
          progress={goal.progress}
          colorKey={goal.colorKey}
          detail={
            goal.progressMode === "auto" && goal.tasks.length > 0
              ? `${doneCount}/${goal.tasks.length}`
              : undefined
          }
        />
        {canEdit && (
          <button className="lk mu" onClick={() => setEditing((v) => !v)}>
            {editing ? "닫기" : "편집"}
          </button>
        )}
      </div>

      {goal.tasks.length > 0 && !editing && (
        <div className="gtasks">
          {goal.tasks.map((task) => (
            <span key={task.id} className={`gchip ${task.status === "done" ? "done" : ""}`}>
              {task.status === "done" ? "✓ " : ""}
              {task.title}
            </span>
          ))}
        </div>
      )}

      {editing && (
        <div className="gedit">
          <div className="gedit-r">
            <label>진척 방식</label>
            <select
              value={goal.progressMode}
              onChange={(e) => save({ progressMode: e.target.value })}
              disabled={busy}
            >
              <option value="auto">자동 — 연결 업무 완료율</option>
              <option value="manual">수동 입력</option>
            </select>
            {goal.progressMode === "manual" && (
              <>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={manualValue}
                  onChange={(e) => setManualValue(Number(e.target.value))}
                  style={{ width: 72 }}
                />
                <button className="lk" disabled={busy} onClick={() => save({ progress: manualValue })}>
                  저장
                </button>
              </>
            )}
          </div>
          <div className="gedit-r">
            <label>연결 업무 (다중 선택 · 선택 사항)</label>
          </div>
          <div className="glinks">
            {linkableTasks.map((task) => (
              <label key={task.id} className="glink">
                <input
                  type="checkbox"
                  checked={selected.includes(task.id)}
                  onChange={(e) =>
                    setSelected((prev) =>
                      e.target.checked ? [...prev, task.id] : prev.filter((id) => id !== task.id)
                    )
                  }
                />
                {task.title}
                <em>
                  {task.assignee_name ?? "-"} · {task.status}
                </em>
              </label>
            ))}
          </div>
          <button className="lk" disabled={busy} onClick={() => save({ taskIds: selected })}>
            연결 저장
          </button>
          {user.role === "lead" && (
            <div className="gedit-r garchive-r">
              <button className="gbtn mu" disabled={busy} onClick={() => setConfirming(true)}>
                보관
              </button>
            </div>
          )}
        </div>
      )}
      {confirming && (
        <ArchiveDialog goal={goal} onClose={() => setConfirming(false)} onArchived={onChanged} />
      )}
    </div>
  );
}

/** 연간·분기 노드 — <details> 접기 + (lead/소유자) 편집 패널 토글 */
function BranchNode({
  goal,
  user,
  onChanged,
  children,
}: {
  goal: GoalNode;
  user: SessionUser;
  onChanged: () => void;
  children: React.ReactNode;
}) {
  const canEdit = user.role === "lead" || goal.ownerActorId === user.id;
  const [editing, setEditing] = useState(false);
  const isYear = goal.periodType === "year";

  return (
    <details className={`gnode ${isYear ? "" : "q"}`} open>
      <summary>
        <svg className="cv" viewBox="0 0 24 24">
          <path d="M9 6l6 6-6 6" />
        </svg>
        {isYear ? (
          <span className="gtag y">연간</span>
        ) : (
          <span className="gtag">
            Q{Math.floor((Number(goal.periodStart.slice(5, 7)) - 1) / 3) + 1}
          </span>
        )}
        <span className="gtitle">{goal.title}</span>
        <span className="gsp" />
        <GoalProgress progress={goal.progress} colorKey={goal.colorKey} />
        {canEdit && (
          <button
            className="lk mu"
            onClick={(e) => {
              e.preventDefault(); // summary 토글 방지
              setEditing((v) => !v);
            }}
          >
            {editing ? "닫기" : "편집"}
          </button>
        )}
      </summary>
      {editing && <NodeEditPanel goal={goal} isLead={user.role === "lead"} onChanged={onChanged} />}
      {children}
    </details>
  );
}

export default function GoalTree({
  tree,
  linkableTasks,
  user,
  year,
  onChanged,
}: {
  tree: GoalNode[];
  linkableTasks: LinkableTask[];
  user: SessionUser;
  year: number;
  onChanged: () => void;
}) {
  const isLead = user.role === "lead";
  const years = tree.filter((n) => n.periodType === "year");
  const orphans = tree.filter((n) => n.periodType !== "year");

  return (
    <div className="gtree">
      {years.length === 0 && (
        <p className="gempty">
          {year}년 연간 목표가 없습니다.{isLead ? " 아래에서 추가하세요." : ""}
        </p>
      )}

      {years.map((yearGoal) => (
        <BranchNode key={yearGoal.id} goal={yearGoal} user={user} onChanged={onChanged}>
          {yearGoal.children.map((quarter) => (
            <BranchNode key={quarter.id} goal={quarter} user={user} onChanged={onChanged}>
              {quarter.children.map((month) => (
                <MonthGoalRow
                  key={month.id}
                  goal={month}
                  user={user}
                  linkableTasks={linkableTasks}
                  onChanged={onChanged}
                />
              ))}
              {isLead && (
                <AddGoalForm periodType="month" parent={quarter} year={year} onDone={onChanged} />
              )}
            </BranchNode>
          ))}
          {isLead && (
            <AddGoalForm periodType="quarter" parent={yearGoal} year={year} onDone={onChanged} />
          )}
        </BranchNode>
      ))}

      {orphans.length > 0 && (
        <p className="gempty">상위 없는 목표 {orphans.length}건 — 상위 목표를 지정해 정리하세요.</p>
      )}

      {isLead && <AddGoalForm periodType="year" parent={null} year={year} onDone={onChanged} />}
    </div>
  );
}
