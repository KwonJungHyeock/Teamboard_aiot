"use client";

// 목표 미연결 업무 일괄 연결 (MD-P-2026-024 회신 6 지시 21).
//
// 업무를 하나씩 열어 붙이게 하면 아무도 안 한다. 한 화면에서 끝나야 한다.
//   · 행에서 바로 월 목표 지정 → 저장 즉시 목록에서 사라진다
//   · 체크박스 다중 선택 → 상단에서 한 번에 지정 (같은 과제 묶음이 실제 사용 흐름)
//   · 프로젝트별 접기
//   · 기한 없는 업무는 같은 행에서 날짜를 바로 넣는다
//
// 새 시각 토큰을 만들지 않는다. §C 목록 규격(.dl / .dl-row 38px · 12.5px)을 그대로 쓴다.
import { useMemo, useState } from "react";
import { toast } from "@/lib/quick";
import SectionEmpty from "./SectionEmpty";
import ErrorNote from "./ErrorNote";

export interface UnlinkedTask {
  id: number;
  title: string;
  status: string;
  progress: number;
  projectId: number | null;
  projectName: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  areaId: number;
}
export interface MonthGoalOption { id: number; title: string; period_start: string }

/** 셀렉트에서 "목표 없음"을 나타내는 특별값. 실제 목표 id 와 겹치지 않게 음수를 쓴다. */
const NONE = -1;

const STATUS_LABEL: Record<string, string> = {
  todo: "대기", doing: "진행", review: "리뷰", done: "완료",
};

export default function UnlinkedTaskPanel({
  tasks, monthGoals, onChanged,
}: {
  tasks: UnlinkedTask[];
  monthGoals: MonthGoalOption[];
  onChanged: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkGoal, setBulkGoal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  // 프로젝트별로 묶는다. 프로젝트 없는 업무는 마지막 묶음.
  const groups = useMemo(() => {
    const m = new Map<string, UnlinkedTask[]>();
    for (const t of tasks) {
      const key = t.projectName ?? "(프로젝트 없음)";
      const list = m.get(key) ?? [];
      list.push(t);
      m.set(key, list);
    }
    return Array.from(m.entries());
  }, [tasks]);

  const toggleGroup = (k: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  const toggleCheck = (id: number) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  /**
   * 업무를 목표에 붙인다. 사용자가 직접 고른 것이므로 goal_source 는 manual 이 된다.
   * goalId === NONE 이면 "목표 없음"으로 지정한다 (지시 23-3) —
   * 미지정(아직 안 정함)과 달리 성과 집계 대상이 아니라고 사람이 정한 것이다.
   */
  async function link(ids: number[], goalId: number) {
    if (goalId === 0 || ids.length === 0 || busy) return;
    setBusy(true); setError("");
    const body = goalId === NONE ? { goalSource: "none" } : { goalIds: [goalId] };
    let ok = 0;
    for (const id of ids) {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (res && res.ok) ok += 1;
    }
    setBusy(false);
    if (ok === 0) { setError("연결에 실패했어요."); return; }
    toast(goalId === NONE ? `업무 ${ok}건을 목표 없음으로 지정했어요` : `업무 ${ok}건을 목표에 연결했어요`);
    setChecked(new Set());
    setBulkGoal(0);
    onChanged();
  }

  async function setDue(id: number, due: string) {
    if (!due) return;
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate: due }),
    }).catch(() => null);
    if (!res || !res.ok) { setError("기한 저장에 실패했어요."); return; }
    toast("기한을 지정했어요");
    onChanged();
  }

  if (tasks.length === 0) {
    return (
      <div className="dl">
        <SectionEmpty text="목표에 연결되지 않은 업무가 없어요 — 모든 업무가 목표에 집계되거나 '목표 없음'으로 정리됐습니다" />
      </div>
    );
  }

  return (
    <section className="utp" aria-label="목표 미연결 업무">
      {/* 일괄 지정 줄 — 체크한 업무를 한 번에 붙인다 */}
      <div className="utp-bulk">
        <span className="utp-n num">{checked.size > 0 ? `${checked.size}건 선택` : `${tasks.length}건`}</span>
        <select value={bulkGoal} onChange={(e) => setBulkGoal(Number(e.target.value))} disabled={checked.size === 0}>
          <option value={0}>월 목표 선택…</option>
          <option value={NONE}>목표 없음 (성과 집계 대상 아님)</option>
          {monthGoals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <button className="btn-primary" disabled={busy || checked.size === 0 || bulkGoal === 0}
          onClick={() => link(Array.from(checked), bulkGoal)}>
          선택 업무 연결
        </button>
        {checked.size > 0 && (
          <button className="btn-ghost" onClick={() => setChecked(new Set())}>선택 해제</button>
        )}
        {error && <ErrorNote message={error} />}
      </div>

      {monthGoals.length === 0 && (
        <SectionEmpty text="이번 달 팀 월 목표가 없어요 — 목표를 먼저 만들어 주세요" action={{ label: "목표 만들기 →", href: "/goals" }} />
      )}

      {groups.map(([name, list]) => {
        const off = collapsed.has(name);
        const allOn = list.every((t) => checked.has(t.id));
        return (
          <div className="utp-g" key={name}>
            <div className="utp-gh">
              <button className="utp-fold" aria-expanded={!off} onClick={() => toggleGroup(name)}>
                {off ? "▸" : "▾"} {name}
              </button>
              <span className="utp-n num">{list.length}</span>
              <span className="gsp" />
              <button className="lk mu" onClick={() => setChecked((prev) => {
                const n = new Set(prev);
                for (const t of list) { if (allOn) n.delete(t.id); else n.add(t.id); }
                return n;
              })}>
                {allOn ? "이 묶음 해제" : "이 묶음 전체 선택"}
              </button>
            </div>

            {!off && (
              <div className="dl">
                <div className="dl-head">
                  <span className="dl-c utp-chk" />
                  <span className="dl-c utp-t">업무</span>
                  <span className="dl-c utp-a">담당</span>
                  <span className="dl-c utp-s">상태</span>
                  <span className="dl-c utp-d">기한</span>
                  <span className="dl-c utp-g2">목표</span>
                </div>
                {list.map((t) => (
                  <div className="dl-row" key={t.id}>
                    <span className="dl-c utp-chk">
                      <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggleCheck(t.id)}
                        aria-label={`${t.title} 선택`} />
                    </span>
                    <span className="dl-c utp-t" title={t.title}>{t.title}</span>
                    <span className="dl-c utp-a">{t.assigneeName ?? "—"}</span>
                    <span className="dl-c utp-s">{STATUS_LABEL[t.status] ?? t.status}</span>
                    <span className="dl-c utp-d">
                      {/* 기한 없는 업무는 여기서 바로 넣는다 — 별도 작업으로 남기지 않는다 */}
                      <input type="date" defaultValue={t.dueDate ?? ""}
                        className={t.dueDate ? "" : "utp-nodue"}
                        onChange={(e) => setDue(t.id, e.target.value)}
                        aria-label={`${t.title} 기한`} />
                      {!t.dueDate && <em className="utp-nodue-t">기한 없음</em>}
                    </span>
                    <span className="dl-c utp-g2">
                      <select defaultValue={0} disabled={busy}
                        onChange={(e) => link([t.id], Number(e.target.value))}
                        aria-label={`${t.title} 목표 지정`}>
                        <option value={0}>선택…</option>
                        <option value={NONE}>목표 없음</option>
                        {monthGoals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                      </select>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
