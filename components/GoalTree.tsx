"use client";

// 목표 트리 (Phase 4) — 연간 > 분기 > 월 3단, <details> 접기.
// 진척 수치는 서버(lib/goals.ts) 계산 결과만 표시한다.
import { createContext, useContext, useEffect, useState } from "react";
import { toast } from "@/lib/quick";
import { countTasks, basisLabel, progressDisplay, uncountedChildrenLabel } from "@/lib/progress";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import GoalProgress from "./GoalProgress";
import SectionEmpty from "./SectionEmpty";
import { pfill } from "@/lib/progress-bar";

// 상태 라벨 (MD-P-2026-009 §D) — 판정 불가(null)는 칩을 그리지 않는다.
const GOAL_STATUS_KO: Record<string, string> = { ontrack: "온트랙", risk: "리스크", wait: "대기", done: "완료" };

// 목표 제목 클릭 → 상세 패널 (파트 C). 트리 깊이가 깊어 context로 전달.
const OpenGoalCtx = createContext<((id: number) => void) | null>(null);
function GoalTitle({ goal }: { goal: GoalNode }) {
  const open = useContext(OpenGoalCtx);
  if (!open) return <span className="gtitle">{goal.title}</span>;
  return (
    <button className="gtitle gtitle-btn" onClick={() => open(goal.id)} title="목표 상세 열기">
      {goal.title}
    </button>
  );
}

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


/** 오늘이 그 달인가. 현재 월 표시(B-3)에 쓴다. */
function isCurrentMonth(periodStart: string): boolean {
  const now = new Date();
  return periodStart.slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 오늘이 그 분기인가. 현재 분기만 기본 펼침(B-2). */
function isCurrentQuarter(periodStart: string, periodEnd: string): boolean {
  const t = new Date().toISOString().slice(0, 10);
  return periodStart <= t && t <= periodEnd;
}

/** 남은 기간 D-n. 이미 지났으면 "기간 종료". */
function dday(periodEnd: string): string {
  const end = new Date(`${periodEnd}T00:00:00Z`).getTime();
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const d = Math.round((end - today) / 86400000);
  return d < 0 ? "기간 종료" : d === 0 ? "D-DAY" : `D-${d}`;
}

/**
 * B-5 — 월 목표의 기간이 상위 분기 밖인가.
 *
 * 대부분의 목표가 placed 라 기간을 바꿔도 상위가 따라가지 않는다(A-신1-6). 그게 맞는 동작이다.
 * 다만 Q3 섹션 안에 12월 배지를 단 행이 생기면 보는 사람이 멈춘다.
 * **오류가 아니므로 막지 않는다. 알리기만 한다.**
 */
function outsideParentPeriod(
  goal: GoalNode,
  parent?: { start: string; end: string; label: string; title?: string } | null
): { label: string; hint: string } | null {
  if (!parent) return null;
  if (goal.periodStart >= parent.start && goal.periodStart <= parent.end) return null;
  return {
    label: parent.label,
    hint: `이 목표는 "${parent.title ?? parent.label}" 아래에 있지만 기간은 ${Number(goal.periodStart.slice(5, 7))}월입니다`,
  };
}

/** 분기 라벨 — "Q3". 화면마다 다시 조립하지 않는다. */
function quarterLabel(periodStart: string): string {
  return `Q${Math.floor((Number(periodStart.slice(5, 7)) - 1) / 3) + 1}`;
}

/** 오늘이 속한 칸. 다른 해를 보고 있으면 첫 칸으로 둔다 (지시 17-3). */
function defaultSlot(periodType: "year" | "quarter" | "month", year: number): number {
  const now = new Date();
  if (now.getFullYear() !== year) return 1;
  const month = now.getMonth() + 1;
  if (periodType === "quarter") return Math.floor((month - 1) / 3) + 1;
  if (periodType === "month") return month;
  return 1;
}

interface ParentInfo {
  spec: { periodType: string; periodStart: string; label: string } | null;
  candidates: { id: number; title: string }[];
}

/**
 * 목표 만들기 (MD-P-2026-029 §A1~§A3).
 *
 * **상위 선택이 없다.** 사용자는 주기와 기간만 고른다.
 * 8월 목표는 무조건 Q3 아래로 들어간다 — 기간이 이미 계층을 정하는데
 * 셀렉트로 물어보고 있었고, 그래서 #13·#15 가 월과 분기에 중복으로 생겼다.
 *
 * 상위가 없을 때 **조용히 만들지 않는다** (§A2). 물어보고, 체크했을 때만 함께 만든다.
 * 후보가 하나면 묻지 않는다 (§A3) — 고를 것이 없는 선택지는 질문이 아니라 장애물이다.
 */
function AddGoalForm({
  periodType: periodTypeProp,
  year,
  scope = "team",
  placedParent = null,
  onDone,
}: {
  /** "any" = 전역 "+ 새 목표" — 주기까지 고르게 한다 (A-신1-3). */
  periodType: "year" | "quarter" | "month" | "any";
  year: number;
  scope?: "team" | "personal";
  /**
   * **만든 자리**의 상위 (A-신1-1 · A-신1-2).
   * 분기 섹션의 "+ 월 목표" 면 그 분기, 연간 카드의 "+ 분기 목표" 면 그 연간.
   * 있으면 상위를 묻지 않는다 — 누른 사람은 이미 어디에 만들지 알고 있다.
   * null 이면 전역 "+ 새 목표" 다. 그때만 고르게 한다 (A-신1-3).
   */
  placedParent?: GoalNode | null;
  onDone: () => void;
}) {
  // 전역 진입점은 주기부터 고른다. 자리에서 만든 것은 주기가 이미 정해져 있다.
  const [pt, setPt] = useState<"year" | "quarter" | "month">(
    periodTypeProp === "any" ? "month" : periodTypeProp);
  const periodType = periodTypeProp === "any" ? pt : periodTypeProp;
  const [title, setTitle] = useState("");
  // A-신1-5 — 만든 자리가 기간 기본값을 제안한다. 분기 섹션이면 그 분기의 현재 월,
  // 연간 카드면 현재 분기. 사용자가 바꿀 수 있고, 바꿔도 상위는 따라가지 않는다.
  const [slot, setSlot] = useState(() => {
    if (!placedParent) return defaultSlot(periodTypeProp === "any" ? "month" : periodTypeProp, year);
    const pm = Number(placedParent.periodStart.slice(5, 7));
    const now = new Date();
    if (periodType === "month") {
      const cur = now.getMonth() + 1;
      // 이 분기 안에 현재 월이 있으면 그것, 아니면 분기 첫 달
      return cur >= pm && cur <= pm + 2 && now.getFullYear() === year ? cur : pm;
    }
    if (periodType === "quarter") return defaultSlot("quarter", year);
    return 1;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState<ParentInfo | null>(null);
  const [pick, setPick] = useState<number | 0>(0);        // 후보 여럿일 때 고른 것
  const [alsoMake, setAlsoMake] = useState(false);        // "함께 만들까요?" 체크
  const [parentTitle, setParentTitle] = useState("");

  const pad = (n: number) => String(n).padStart(2, "0");
  const periodStart =
    periodType === "year" ? `${year}-01-01`
    : periodType === "quarter" ? `${year}-${pad((slot - 1) * 3 + 1)}-01`
    : `${year}-${pad(slot)}-01`;

  // 기간이 정해지는 순간 상위를 미리 확인한다 — 저장한 뒤에 알려주면
  // 이미 만들어진 뒤라 "함께 만들까요?" 가 성립하지 않는다.
  useEffect(() => {
    if (periodTypeProp === "any") setSlot(defaultSlot(pt, year));
  }, [pt, periodTypeProp, year]);

  useEffect(() => {
    // 만든 자리가 정했으면 물어볼 것이 없다 (A-신1-1 · A-신1-2).
    if (!open || periodType === "year" || placedParent) { setParent(null); return; }
    let alive = true;
    fetch(`/api/goals/parent?periodType=${periodType}&periodStart=${periodStart}&scope=${scope}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setParent(d);
        setPick(d.candidates.length === 1 ? d.candidates[0].id : 0);
        setParentTitle(d.candidates.length === 0 && d.spec ? `${d.spec.label} 목표` : "");
        setAlsoMake(false);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, periodType, periodStart, scope, placedParent]);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodType, title, periodStart, scope,
        // 만든 자리가 있으면 그게 이긴다 (A-신1).
        placedParentId: placedParent?.id ?? undefined,
        // 후보가 여럿일 때만 의미가 있다. 하나면 서버가 알아서 고른다.
        preferredParentId: pick || undefined,
        createParent: alsoMake && parentTitle.trim() ? { title: parentTitle.trim() } : undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { setError(body?.error ?? "생성 실패"); return; }
    if (body?.createdParent) toast(`상위 목표 "${body.createdParent.title}" 도 함께 만들었어요`);
    else if (body?.parentId == null && periodType !== "year") toast("상위 없이 만들었어요");
    setTitle(""); setOpen(false);
    onDone();
  }

  if (!open) {
    return (
      <div className="gadd gadd-shut">
        <button className="lk gadd-open" onClick={() => { setSlot(defaultSlot(periodType, year)); setOpen(true); }}>
          {periodTypeProp === "any" ? "＋ 새 목표" : `+ ${PERIOD_LABEL[periodType]} 목표`}
        </button>
      </div>
    );
  }

  const noParent = !placedParent && periodType !== "year" && parent && parent.candidates.length === 0 && parent.spec;
  const manyParents = parent && parent.candidates.length > 1;

  return (
    <div className="gadd">
      <div className="gadd-row">
        {periodTypeProp === "any" && (
          <select value={pt} onChange={(e) => setPt(e.target.value as typeof pt)} aria-label="주기">
            <option value="month">월 목표</option>
            <option value="quarter">분기 목표</option>
            <option value="year">연간 목표</option>
          </select>
        )}
        {periodType === "quarter" && (
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="분기">
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
          </select>
        )}
        {periodType === "month" && (
          // 상위 분기에 매이지 않는다 — 12개월 전부 고를 수 있고, 고른 달이 분기를 정한다.
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="월">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
          </select>
        )}
        <input
          placeholder={`${PERIOD_LABEL[periodType]} 목표 제목`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !noParent && submit()}
          autoFocus
        />
        <button className="lk" onClick={submit} disabled={busy || !title.trim()}>추가</button>
        <button className="lk mu" onClick={() => { setOpen(false); setTitle(""); setError(""); }}>취소</button>
      </div>

      {/* 만든 자리가 정한 경우 — 묻지 않되 어디로 들어가는지는 보인다 (A-신1-1·2). */}
      {placedParent && (
        <p className="gadd-where">→ <b>{placedParent.title}</b> 아래로 들어갑니다</p>
      )}

      {/* 어디로 들어가는지 항상 보인다. 고르게 하지는 않되 숨기지도 않는다. */}
      {!placedParent && periodType !== "year" && parent?.spec && !noParent && !manyParents && (
        <p className="gadd-where">
          {parent.candidates.length === 1
            ? <>→ <b>{parent.candidates[0].title}</b> 아래로 들어갑니다</>
            : <>→ 상위 없음</>}
        </p>
      )}

      {/* §A3 · A-신1-3 — 전역 "+ 새 목표" 에서 후보가 둘 이상일 때만 고르게 한다 */}
      {!placedParent && manyParents && (
        <p className="gadd-where">
          → 어느 {parent!.spec!.label} 아래인가요?{" "}
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="상위 목표">
            <option value={0}>상위 없음</option>
            {parent!.candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </p>
      )}

      {/* §A2 — 없으면 묻는다. 체크하지 않으면 상위 없이 만든다. */}
      {!placedParent && noParent && (
        <div className="gadd-mkparent">
          <label>
            <input type="checkbox" checked={alsoMake} onChange={(e) => setAlsoMake(e.target.checked)} />
            {parent!.spec!.label} 목표가 없습니다. 함께 만들까요?
          </label>
          {alsoMake && (
            <input
              className="gadd-ptitle"
              value={parentTitle}
              onChange={(e) => setParentTitle(e.target.value)}
              placeholder={`${parent!.spec!.label} 목표 제목`}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          )}
        </div>
      )}

      {error && <span className="gerr">{error}</span>}
    </div>
  );
}

function MonthGoalRow({
  goal,
  user,
  linkableTasks,
  parentPeriod,
  onChanged,
}: {
  goal: GoalNode;
  user: SessionUser;
  linkableTasks: LinkableTask[];
  /** 상위 분기의 기간. B-5 안내 칩 판정에 쓴다. 없으면 판정하지 않는다. */
  parentPeriod?: { start: string; end: string; label: string; title?: string } | null;
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

  // 분모·완료 판정은 lib/progress.ts 하나만 쓴다 (MD-P-2026-024 §3). 화면에서 세지 않는다.
  const { excluded: droppedCount } = countTasks(goal.tasks.map((t) => ({ ...t, progress: 0 })));

  // B-3 — 연결 업무 칩은 기본으로 숨긴다. 늘 펼쳐져 있으면 행이 목록이 아니라 문단이 된다.
  const [showTasks, setShowTasks] = useState(false);
  // B-5 — 기간이 상위 분기 밖인가. placed 라 일부러 그럴 수 있으므로 **오류가 아니다**.
  // 막지 않고 알리기만 한다 — 보는 사람이 "왜 Q3 안에 12월이 있지" 하고 멈추지 않게.
  const outside = outsideParentPeriod(goal, parentPeriod);

  return (
    <div className={`grow${isCurrentMonth(goal.periodStart) ? " now" : ""}`}>
      <div className="grow-h">
        <span className="gtag">{goal.periodStart.slice(5, 7)}월</span>
        <GoalTitle goal={goal} />
        {goal.progressManual !== null && <span className="gtag mu">수동</span>}
        {goal.status && <span className={`gstatus st-${goal.status}`}>{GOAL_STATUS_KO[goal.status]}</span>}
        {outside && (
          <span className="gout" tabIndex={0} title={outside.hint} aria-label={outside.hint}>
            기간이 {outside.label} 밖
          </span>
        )}
        <span className="gsp" />
        {droppedCount > 0 && <em className="gdrop">중단 {droppedCount}건</em>}
        {goal.tasks.length > 0 && (
          <button className="lk mu grow-n" aria-expanded={showTasks} onClick={() => setShowTasks((v) => !v)}>
            업무 {goal.tasks.length}건
          </button>
        )}
        <GoalProgress
          progress={goal.progress}
          colorKey={goal.colorKey}
          // 진척 근거를 옆에 붙인다 — 정의가 바뀌었으니 분모가 보여야 한다 (지시 1)
          detail={goal.progress === null ? undefined : basisLabel(goal.countedTasks)}
          closing={goal.closing}
          counted={goal.countedTasks}
          periodType={goal.periodType}
        />
        {canEdit && (
          <button className="lk mu gedit-b" onClick={() => setEditing((v) => !v)}>
            {editing ? "닫기" : "편집"}
          </button>
        )}
      </div>

      {goal.tasks.length > 0 && !editing && showTasks && (
        <div className="gtasks">
          {goal.tasks.map((task) => (
            <span
              key={task.id}
              className={`gchip ${task.status === "done" ? "done" : task.status === "dropped" ? "drop" : ""}`}
            >
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


/**
 * B-1 연간 요약 카드 — 연간은 트리에서 뺀다.
 *
 * 연간·분기·월이 배지 크기 차이로만 구분돼서 새로 온 사람이 층을 못 읽었다.
 * 연간은 "올해 무엇을 하는가"라 트리 안의 한 줄이 아니라 **화면 위의 카드**여야 한다.
 */
function YearCard({
  goal, user, year, scope, canAdd, onChanged,
}: {
  goal: GoalNode; user: SessionUser; year: number;
  scope: "team" | "personal"; canAdd: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const canEdit = user.role === "lead" || goal.ownerActorId === user.id;
  const open = useContext(OpenGoalCtx);
  // 표시 결정은 GoalProgress 와 **같은 함수**에서 나온다 (지시 30-5).
  // 판정만 공유하면 라벨 조립이 또 갈라진다 — 실제로 그렇게 갈라졌다.
  const d = progressDisplay(goal.progress, goal.countedTasks);
  return (
    <section className="ycard" aria-label={`연간 목표 ${goal.title}`}>
      <div className="ycard-h">
        <span className="gtag y">연간</span>
        <span className="gsp" />
        <span className="ycard-d num">{dday(goal.periodEnd)}</span>
      </div>
      <h3 className="ycard-t" onClick={open ? () => open(goal.id) : undefined}>{goal.title}</h3>
      {/* 표본 가드 (지시 16) — 집계 대상이 1~2건이면 **막대를 그리지 않는다.**
          이 카드는 GoalProgress 를 쓰지 않고 직접 그려서 가드가 빠져 있었다.
          업무 1건짜리 연간 목표가 100% 초록 막대로 뜨는 것이 지시 16 이 막으려던 바로 그 장면이다.
          030 §A3 로 프로젝트 경유가 빠지면서 실제로 그 상태에 닿는 목표가 생겼다. */}
      <div className="ycard-bar">
        <div className={`bar${d.drawBar ? "" : " empty"}`}>
          {d.drawBar && <i className={goal.colorKey ?? "edu"} style={pfill(goal.progress!)} />}
        </div>
      </div>
      <div className="ycard-m">
        <span className={`ycard-p num${d.hasValue ? (d.lowConfidence ? " low" : "") : " none"}`}>
          {d.hasValue ? `${goal.progress}%` : "집계 없음"}
        </span>
        {d.basis && <em>{d.basis}</em>}
      </div>
      {canAdd && (
        // B-1 · A-신1-2 — 여기서 만들면 상위는 이 연간이다. 묻지 않는다.
        <AddGoalForm periodType="quarter" year={year} scope={scope} placedParent={goal} onDone={onChanged} />
      )}
      {canEdit && (
        <button className="lk mu ycard-e" onClick={() => setEditing((v) => !v)}>{editing ? "닫기" : "편집"}</button>
      )}
      {editing && <NodeEditPanel goal={goal} isLead={user.role === "lead"} onChanged={onChanged} />}
    </section>
  );
}

/**
 * B-2 분기 섹션 — 분기는 "큰 과제"다.
 *
 * 현재 분기만 기본 펼침. 접혀 있어도 진척은 보인다 —
 * 접었다는 이유로 숫자가 사라지면 접을 이유가 없어진다.
 */
function QuarterSection({
  goal, user, year, scope, canAdd, linkableTasks, onChanged,
}: {
  goal: GoalNode; user: SessionUser; year: number;
  scope: "team" | "personal"; canAdd: boolean;
  linkableTasks: LinkableTask[]; onChanged: () => void;
}) {
  const [open, setOpen] = useState(() => isCurrentQuarter(goal.periodStart, goal.periodEnd));
  const [editing, setEditing] = useState(false);
  const canEdit = user.role === "lead" || goal.ownerActorId === user.id;
  const parentPeriod = { start: goal.periodStart, end: goal.periodEnd, label: quarterLabel(goal.periodStart), title: goal.title };

  return (
    <section className={`qsec${open ? " open" : ""}`} aria-label={`분기 목표 ${goal.title}`}>
      <div className={`qsec-h ${goal.colorKey ?? "edu"}`}>
        {/* §E3 (B-15) — **button 안에 button 을 두지 않는다.**
            HTML 규격상 올 수 없어 브라우저가 파싱 단계에서 바깥을 조기 종료하거나 중첩을
            무시한다. 그래서 화면마다 다르게 동작하고, 실제로 접기를 누르면 목표 상세가
            열렸다. 하이드레이션 경고로도 콘솔에 뜬다 — 검사기가 그걸 잡아 여기까지 왔다.
            바깥을 `div[role=button]` 으로 바꾸지 않는다. 그건 같은 문제를 접근성 트리에서만
            숨기는 것이다. 접기 토글과 제목을 **형제로** 둔다. */}
        <button className="qsec-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          aria-label={`${quarterLabel(goal.periodStart)} ${open ? "접기" : "펼치기"}`}>
          <svg className="cv" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
          <span className="qsec-q">{quarterLabel(goal.periodStart)}</span>
        </button>
        <GoalTitle goal={goal} />
        <span className="gsp" />
        {/* 접힌 헤더에도 진척은 보인다 */}
        <GoalProgress progress={goal.progress} colorKey={goal.colorKey}
          detail={goal.progress === null ? undefined : basisLabel(goal.countedTasks)}
          closing={goal.closing} counted={goal.countedTasks} periodType={goal.periodType} />
        {canEdit && (
          <button className="lk mu gedit-b" onClick={() => setEditing((v) => !v)}>{editing ? "닫기" : "편집"}</button>
        )}
      </div>
      {editing && <NodeEditPanel goal={goal} isLead={user.role === "lead"} onChanged={onChanged} />}
      {open && (
        <div className="qsec-b">
          {goal.children.length === 0 ? (
            // B-4 — 한 줄. 삽화도 버튼도 두지 않는다 (§G 섹션 빈 상태 규격).
            <SectionEmpty text="이 분기에 월 목표가 없어요" />
          ) : (
            goal.children.map((m) => (
              <MonthGoalRow key={m.id} goal={m} user={user} linkableTasks={linkableTasks}
                parentPeriod={parentPeriod} onChanged={onChanged} />
            ))
          )}
          {/* B-2 · A-신1-1 — 섹션 하단에 한 번만. 분기마다 반복하지 않는다. */}
          {canAdd && (
            <AddGoalForm periodType="month" year={year} scope={scope} placedParent={goal} onDone={onChanged} />
          )}
        </div>
      )}
    </section>
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
        <GoalTitle goal={goal} />
        <span className="gsp" />
        <GoalProgress progress={goal.progress} colorKey={goal.colorKey}
          detail={goal.progress === null ? undefined : basisLabel(goal.countedTasks)}
          closing={goal.closing}
          counted={goal.countedTasks}
          periodType={goal.periodType} />
        {canEdit && (
          <button
            className="lk mu gedit-b"
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
  onOpenGoal,
  scope = "team",
}: {
  tree: GoalNode[];
  linkableTasks: LinkableTask[];
  user: SessionUser;
  year: number;
  onChanged: () => void;
  onOpenGoal?: (id: number) => void;
  scope?: "team" | "personal";
}) {
  const isLead = user.role === "lead";
  // 팀 목표는 lead만 추가, 개인 목표는 본인 누구나 추가 (파트 A/C)
  const canAdd = scope === "personal" || isLead;
  const years = tree.filter((n) => n.periodType === "year");
  const orphans = tree.filter((n) => n.periodType !== "year");

  return (
    <OpenGoalCtx.Provider value={onOpenGoal ?? null}>
    <div className="gtree">
      {/* 여기에 있던 빈 상태는 삭제했다 (MD-P-2026-026 §A).
          GoalsView 가 tree.length === 0 이면 자체 빈 상태로 먼저 끝내므로
          이 분기는 렌더된 적이 없었다. 같은 상황에 빈 상태를 두 개 두면
          어느 쪽이 뜨는지 추적할 수 없고, 한쪽은 반드시 낡는다. */}

      {/* B-1 — 연간은 트리에서 빼고 화면 상단 요약 카드로. 셋을 넘으면 가로 스크롤. */}
      {years.length > 0 && (
        <div className={`ycards${years.length > 3 ? " scroll" : ""}`}>
          {years.map((y) => (
            <YearCard key={y.id} goal={y} user={user} year={year} scope={scope} canAdd={canAdd} onChanged={onChanged} />
          ))}
        </div>
      )}

      {/* B-2 — 분기는 섹션. 연간에 매달린 순서 그대로 편다. */}
      {years.flatMap((y) => y.children).map((quarter) => (
        <QuarterSection key={quarter.id} goal={quarter} user={user} year={year} scope={scope}
          canAdd={canAdd} linkableTasks={linkableTasks} onChanged={onChanged} />
      ))}

      {/* 상위 없는 목표도 화면에 띄운다 — 예전엔 건수만 세고 렌더하지 않아 열 방법이 없었다
          (MD-P-2026-013). 월 목표는 월 행으로, 그 외(분기 등)는 가지로 편다. */}
      {orphans.length > 0 && (
        <div className="gtree-orphan">
          <p className="gtree-orphan-h">상위 없는 목표 {orphans.length}건 — 상위 목표를 지정해 정리하세요.</p>
          {orphans.map((o) =>
            o.periodType === "month" ? (
              <MonthGoalRow key={o.id} goal={o} user={user} linkableTasks={linkableTasks} onChanged={onChanged} />
            ) : (
              <BranchNode key={o.id} goal={o} user={user} onChanged={onChanged}>
                {o.children.map((c) =>
                  c.periodType === "month" ? (
                    <MonthGoalRow key={c.id} goal={c} user={user} linkableTasks={linkableTasks} onChanged={onChanged} />
                  ) : (
                    <BranchNode key={c.id} goal={c} user={user} onChanged={onChanged}>
                      {c.children.map((m) => (
                        <MonthGoalRow key={m.id} goal={m} user={user} linkableTasks={linkableTasks} onChanged={onChanged} />
                      ))}
                    </BranchNode>
                  )
                )}
              </BranchNode>
            )
          )}
        </div>
      )}

      {/* 전역 진입점 (A-신1-3) — 주기까지 고르고, 상위는 기간으로 좁힌 후보에서 고른다.
          자리에서 만드는 것과 달리 여기는 "어디에 만들지"가 정해져 있지 않다. */}
      {canAdd && <AddGoalForm periodType="any" year={year} scope={scope} onDone={onChanged} />}
    </div>
    </OpenGoalCtx.Provider>
  );
}
