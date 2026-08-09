"use client";

// 업무 보드(칸반) — Mission Deck OS 일상 표면: 조용한 카드(무발광·무광택).
// 그룹 기준(상태/영역/담당)으로 컬럼 구성. 카드 드래그 → 그 기준값 변경(낙관적 + 토스트).
// 컬럼 하단 "+ 추가" = 빠른 생성(컬럼값 프리셋). 카드 클릭 → 노션식 상세.
import { useMemo, useState } from "react";
import { openTaskPanel } from "@/lib/task-panel";
import { openQuickCreate } from "@/lib/quick";
import {
  type TaskItem, type BoardGroup, BOARD_STATUSES, STATUS_META, statusColor, areaColor, dday, dueUrgency,
} from "@/lib/task-view";
import SectionEmpty from "./SectionEmpty";
import { pfill } from "@/lib/progress-bar";

interface Col { key: string; label: string; count: number; dot?: string; prefill: Record<string, unknown>; move: Record<string, unknown> }

export default function TaskBoard({
  tasks, today, group, areas, actors, onMove,
}: {
  tasks: TaskItem[];
  today: string;
  group: BoardGroup;
  areas: { id: number; name: string; colorKey: string | null }[];
  actors: { id: number; name: string }[];
  /** 드래그로 기준값 변경 (status/areaId/assigneeId) — 낙관적 반영은 상위에서 */
  onMove: (id: number, patch: Record<string, unknown>) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // 그룹 기준으로 컬럼 정의 + 각 업무의 소속 컬럼 키
  const { cols, keyOf, field } = useMemo(() => {
    if (group === "area") {
      const cols: Col[] = areas.map((a) => ({
        key: `a${a.id}`, label: a.name, count: 0, dot: areaColor(a.colorKey),
        prefill: { areaId: a.id }, move: { areaId: a.id },
      }));
      return { cols, keyOf: (t: TaskItem) => `a${t.areaId}`, field: "areaId" as const };
    }
    if (group === "assignee") {
      const cols: Col[] = [
        ...actors.map((a) => ({ key: `u${a.id}`, label: a.name, count: 0, prefill: { assigneeId: a.id }, move: { assigneeId: a.id } })),
        { key: "u0", label: "미지정", count: 0, prefill: {}, move: { assigneeId: null } },
      ];
      return { cols, keyOf: (t: TaskItem) => `u${t.assigneeId ?? 0}`, field: "assigneeId" as const };
    }
    const cols: Col[] = BOARD_STATUSES.map((s) => ({
      key: s, label: STATUS_META[s].label, count: 0, dot: statusColor(s),
      prefill: { status: s }, move: { status: s },
    }));
    return { cols, keyOf: (t: TaskItem) => t.status, field: "status" as const };
  }, [group, areas, actors]);

  // 업무를 컬럼별로 분배 (보드에 없는 상태(proposed/dropped)는 status 그룹에서 제외)
  const byCol = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const c of cols) m.set(c.key, []);
    for (const t of tasks) {
      const k = keyOf(t);
      if (!m.has(k)) continue; // 미표시 컬럼(예: 상태 grouping의 proposed)
      m.get(k)!.push(t);
    }
    return m;
  }, [tasks, cols, keyOf]);

  function drop(col: Col) {
    setOverKey(null);
    const id = dragId;
    setDragId(null);
    if (id == null) return;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    // 이미 그 컬럼이면 무시
    if (keyOf(t) === col.key) return;
    // 제안 업무는 인박스에서만 승인 (드래그 금지)
    if (t.status === "proposed") return;
    onMove(id, col.move);
  }

  return (
    <div className={`tb-wrap g-${group}`}>
      {cols.map((col) => {
        const items = byCol.get(col.key) ?? [];
        return (
          <section
            key={col.key}
            className={`tb-col${overKey === col.key ? " over" : ""}`}
            aria-label={col.label}
            onDragOver={(e) => { e.preventDefault(); if (overKey !== col.key) setOverKey(col.key); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverKey((k) => (k === col.key ? null : k)); }}
            onDrop={() => drop(col)}
          >
            <div className="tb-col-h">
              {col.dot && <span className="tb-col-dot" style={{ background: col.dot }} />}
              <span className="tb-col-l">{col.label}</span>
              <span className="tb-col-n num">{items.length}</span>
            </div>
            <div className="tb-col-body">
              {items.map((t) => {
                const d = dday(t.dueDate, today);
                const overdue = d.overdue && t.status !== "done" && t.status !== "dropped";
                return (
                  <article
                    key={t.id}
                    className={`tb-card${dragId === t.id ? " dragging" : ""}${t.blocked ? " bkd" : ""}`}
                    draggable={t.status !== "proposed"}
                    onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragId(null); setOverKey(null); }}
                    onClick={() => openTaskPanel(t.id)}
                    role="button"
                  >
                    <div className="tb-card-top">
                      <span className="tb-area">
                        <i style={{ background: areaColor(t.colorKey ?? null) }} />{t.areaName}
                      </span>
                      <span className="tb-id num">#{t.id}</span>
                    </div>
                    <div className="tb-card-title">
                      {t.blocked && (
                        <span className="blk-mark" title={t.blockedReason ? `막힘: ${t.blockedReason}` : "막힘"} aria-label="막힘">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                        </span>
                      )}
                      {t.title}
                    </div>
                    {t.blocked && t.blockedReason && <div className="tb-blk-reason num">막힘 · {t.blockedReason}</div>}
                    <div className="tb-card-meta">
                      <span className="tb-st">
                        <span className={`led s-${t.status}`} style={{ background: statusColor(t.status) }} />
                        {STATUS_META[t.status]?.label ?? t.status}
                      </span>
                      {t.assigneeName && <span className="tb-who">{t.assigneeName}</span>}
                      {d.text && <span className={`tb-dday num${dueUrgency(d.text) === "late" ? " late" : dueUrgency(d.text) === "soon" ? " soon" : ""}`}>{d.text}</span>}
                    </div>
                    <div className="tb-card-prog">
                      <div className="tb-bar"><i style={{ ...pfill(Math.max(t.progress, 2)), background: statusColor(t.status) }} /></div>
                      <span className="tb-pct num">{t.progress}%</span>
                    </div>
                  </article>
                );
              })}
              {items.length === 0 && <SectionEmpty text="비어 있음" />}
              <button
                className="tb-add"
                onClick={(e) => openQuickCreate({ x: e.clientX, y: e.clientY }, col.prefill)}
              >
                ＋ 추가
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
