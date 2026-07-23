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
        </div>
      )}
    </div>
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
        <details key={yearGoal.id} className="gnode" open>
          <summary>
            <svg className="cv" viewBox="0 0 24 24">
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span className="gtag y">연간</span>
            <span className="gtitle">{yearGoal.title}</span>
            <span className="gsp" />
            <GoalProgress progress={yearGoal.progress} colorKey={yearGoal.colorKey} />
          </summary>

          {yearGoal.children.map((quarter) => (
            <details key={quarter.id} className="gnode q" open>
              <summary>
                <svg className="cv" viewBox="0 0 24 24">
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <span className="gtag">
                  Q{Math.floor((Number(quarter.periodStart.slice(5, 7)) - 1) / 3) + 1}
                </span>
                <span className="gtitle">{quarter.title}</span>
                <span className="gsp" />
                <GoalProgress progress={quarter.progress} colorKey={quarter.colorKey} />
              </summary>

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
            </details>
          ))}
          {isLead && (
            <AddGoalForm periodType="quarter" parent={yearGoal} year={year} onDone={onChanged} />
          )}
        </details>
      ))}

      {orphans.length > 0 && (
        <p className="gempty">상위 없는 목표 {orphans.length}건 — 상위 목표를 지정해 정리하세요.</p>
      )}

      {isLead && <AddGoalForm periodType="year" parent={null} year={year} onDone={onChanged} />}
    </div>
  );
}
