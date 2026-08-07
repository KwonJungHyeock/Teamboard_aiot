"use client";

// 업무 테이블 (Phase 3 마감 임박 → Phase 5 공용화) — 홈 "마감 임박"과 /tasks 목록이
// 같은 컴포넌트를 재사용한다 (Phase 5 검수 포인트 6). 컬럼 폭 고정 (프로토타입 colgroup).
// variant="full"(/tasks): 목표·우선순위 컬럼 추가 + 상태 인라인 드롭다운. compact(홈)은 5열 유지.
import { useState } from "react";
import EmptyState from "./EmptyState";
import SectionEmpty, { type SectionEmptyAction } from "./SectionEmpty";
import { toast } from "@/lib/quick";
import { notifyTaskUpdated } from "@/lib/task-panel";
export interface TaskTableRow {
  id: number;
  title: string;
  projectName: string | null;
  colorKey: string | null;
  assigneeName: string | null;
  status: string;
  dday: string | null;
  overdue: boolean;
  priority?: string; // full 전용
  goalNames?: string[]; // full 전용
  areaName?: string; // full 전용
  progress?: number; // full 전용 — 진행률 0~100
  blocked?: boolean;
  blockedReason?: string | null;
  /** MD-P-2026-025 §B2 — 개인 업무 표시. 없으면 팀 공개로 본다. */
  visibility?: "team" | "private";
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  proposed: { label: "제안", cls: "prop" },
  todo: { label: "대기", cls: "todo" },
  doing: { label: "진행", cls: "doing" },
  review: { label: "리뷰", cls: "review" },
  done: { label: "완료", cls: "done" },
  dropped: { label: "중단", cls: "drop" },
};

const PRIORITY_LABEL: Record<string, string> = { high: "높음", mid: "보통", low: "낮음" };
// 인라인 상태 변경 가능한 값 (중단은 사유가 필요해 상세에서만 — 우회 방지)
const INLINE_STATUS = ["todo", "doing", "review", "done"] as const;

export default function TaskTable({
  rows,
  title = "마감 임박",
  sub,
  emptyScope = "section",
  emptyText = "표시할 업무가 없어요",
  emptyHint,
  emptyAction,
  emptyLink,
  onRowClick,
  selectedId,
  variant = "compact",
  onStatusChange,
  accent,
  quickComplete,
}: {
  rows: TaskTableRow[];
  title?: string;
  sub?: string;
  /**
   * 이 표가 **화면 전체**인지 **화면의 한 블록**인지 — 호출자가 정한다 (MD-P-2026-026 §A).
   * 같은 컴포넌트가 /tasks 본문 전체이기도 하고 영역 화면의 한 탭이기도 하다.
   * 예전에는 `compact` 하나가 열 개수와 빈 상태 규격을 겸했고, 그래서
   * 블록 하나가 비었을 뿐인데 88px 삽화와 코랄 버튼이 떴다.
   */
  emptyScope?: "full" | "section";
  emptyText?: string;
  /** emptyScope="full" 전용 — 설명 문장. 섹션에서는 무시된다(한 줄 규격). */
  emptyHint?: string;
  /** emptyScope="full" 전용 — CTA 버튼. */
  emptyAction?: React.ReactNode;
  /** emptyScope="section" 전용 — 텍스트 링크 하나. 버튼은 받지 않는다. */
  emptyLink?: SectionEmptyAction;
  onRowClick?: (id: number) => void;
  selectedId?: number | null;
  variant?: "compact" | "full";
  /** full 전용 — 상태 배지를 드롭다운으로 렌더, 변경 시 호출 */
  onStatusChange?: (id: number, status: string) => void;
  /** 카드 헤더 의미색 accent (홈 영역분리). 예: "coral" */
  accent?: string;
  /** hover 인라인 액션(완료·열기) 활성화 — 낙관적 업데이트 + 토스트 */
  quickComplete?: boolean;
}) {
  const full = variant === "full";
  const colCount = full ? 9 : 5;
  // 낙관적 완료 — 즉시 반영(페이드) 후 PATCH, 실패 시 롤백
  const [doneLocal, setDoneLocal] = useState<Set<number>>(new Set());
  async function completeNow(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setDoneLocal((s) => new Set(s).add(id));
    toast("완료 처리했어요");
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }),
    });
    if (!res.ok) {
      setDoneLocal((s) => { const n = new Set(s); n.delete(id); return n; });
      toast("완료 처리에 실패했어요", "err");
    } else {
      notifyTaskUpdated();
    }
  }
  return (
    <section className={`card${accent ? ` acc-${accent}` : ""}`} aria-label={title}>
      <div className="ch">
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
      </div>
      <table>
        <colgroup>
          {full ? (
            <>
              <col />
              <col style={{ width: "140px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "72px" }} />
              <col style={{ width: "68px" }} />
              <col style={{ width: "118px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "70px" }} />
            </>
          ) : (
            <>
              {/* 업무(제목)만 flex+truncate. 상태·기한은 배지가 안 잘리게 고정 폭(내용에 맞춤). */}
              <col />
              <col style={{ width: "20%" }} />
              <col style={{ width: "76px" }} />
              <col style={{ width: "64px" }} />
              <col style={{ width: "56px" }} />
            </>
          )}
        </colgroup>
        <thead>
          <tr>
            <th>업무</th>
            {full && <th>목표</th>}
            {full && <th>영역</th>}
            <th>프로젝트</th>
            <th>담당</th>
            {full && <th>우선순위</th>}
            {full && <th>진행률</th>}
            <th>상태</th>
            <th>기한</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} style={{ padding: 0 }}>
                {emptyScope === "full" ? (
                  <EmptyState icon="tasks" title={emptyText} hint={emptyHint} action={emptyAction} />
                ) : (
                  <SectionEmpty text={emptyText} action={emptyLink} />
                )}
              </td>
            </tr>
          )}
          {rows.map((t) => {
            const status = STATUS_LABEL[t.status] ?? { label: t.status, cls: "todo" };
            const dueCls = t.overdue
              ? "bad"
              : t.dday === "D-DAY" || t.dday === "D-1" || t.dday === "D-2"
                ? "soon"
                : "";
            const editable = full && onStatusChange && t.status !== "proposed" && t.status !== "dropped";
            return (
              <tr
                key={t.id}
                onClick={onRowClick ? () => onRowClick(t.id) : undefined}
                className={
                  [onRowClick ? "clickable" : "", selectedId === t.id ? "selected" : "", doneLocal.has(t.id) ? "done-opt" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                <td>
                  {t.blocked && (
                    <span className="blk-mark" title={t.blockedReason ? `막힘: ${t.blockedReason}` : "막힘"} aria-label="막힘">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                    </span>
                  )}
                  {t.title}
                  {/* §B2 — 자물쇠 아이콘이 아니라 "개인" 텍스트 칩.
                      아이콘만으로는 무슨 뜻인지 배워야 한다.
                      기존 상태 칩(.st) 규격을 그대로 쓴다 — 새 컴포넌트를 만들지 않는다. */}
                  {t.visibility === "private" && <span className="st priv">개인</span>}
                </td>
                {full && (
                  <td>
                    {t.goalNames && t.goalNames.length > 0 ? t.goalNames.join(", ") : "—"}
                  </td>
                )}
                {full && (
                  <td>
                    {t.areaName ? <span className="areatag">{t.areaName}</span> : "—"}
                  </td>
                )}
                <td>
                  {t.projectName ? (
                    <span className="pj">
                      <i className={t.colorKey ?? "team"} />
                      {t.projectName}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{t.assigneeName ?? "—"}</td>
                {full && (
                  <td>
                    <span className={`prio prio-${t.priority ?? "mid"}`}>
                      {PRIORITY_LABEL[t.priority ?? "mid"] ?? "보통"}
                    </span>
                  </td>
                )}
                {full && (
                  <td className="col-prog">
                    <div className="tt-prog" title={`진행률 ${t.progress ?? 0}%`}>
                      <i className={t.status === "done" ? "pf-green" : "pf-blue"} style={{ width: `${t.progress ?? 0}%` }} />
                    </div>
                    <span className="tt-prog-n">{t.progress ?? 0}%</span>
                  </td>
                )}
                <td className="col-st">
                  {editable ? (
                    <select
                      className={`stsel st-${t.status}`}
                      value={t.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        onStatusChange!(t.id, e.target.value);
                      }}
                    >
                      {INLINE_STATUS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s].label}
                        </option>
                      ))}
                      {/* 현재 값이 인라인 목록 밖이면(예: done→dropped 후 재조회 전) 보존 */}
                      {!(INLINE_STATUS as readonly string[]).includes(t.status) && (
                        <option value={t.status}>{status.label}</option>
                      )}
                    </select>
                  ) : (
                    <span className={`st ${status.cls}`}>{status.label}</span>
                  )}
                </td>
                <td className={`due col-due ${dueCls}`}>
                  <span className="tt-dday">{t.dday ?? "—"}</span>
                  {quickComplete && t.status !== "done" && t.status !== "dropped" && (
                    <span className="tt-row-act">
                      <button className="tt-act c" onClick={(e) => completeNow(t.id, e)} title="완료 처리" aria-label="완료 처리">✓</button>
                      {onRowClick && <button className="tt-act o" onClick={(e) => { e.stopPropagation(); onRowClick(t.id); }} title="열기" aria-label="열기">↗</button>}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
