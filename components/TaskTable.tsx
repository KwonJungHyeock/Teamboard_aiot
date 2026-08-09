"use client";

// 업무 테이블 (Phase 3 마감 임박 → Phase 5 공용화) — 홈 "마감 임박"과 /tasks 목록이
// 같은 컴포넌트를 재사용한다 (Phase 5 검수 포인트 6). 컬럼 폭 고정 (프로토타입 colgroup).
// variant="full"(/tasks): 목표·우선순위 컬럼 추가 + 상태 인라인 드롭다운. compact(홈)은 5열 유지.
import { useRef, useState } from "react";
import EmptyState from "./EmptyState";
import SectionEmpty, { type SectionEmptyAction } from "./SectionEmpty";
import { toast } from "@/lib/quick";
import { notifyTaskUpdated } from "@/lib/task-panel";
import { useCountUp, useExiting, useFlip, useHighlight } from "@/lib/motion";
import { notifyGoalChain } from "@/lib/goal-chain";
import { pfill } from "@/lib/progress-bar";
import { dueUrgency } from "@/lib/task-view";
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
  /** §B3 — 원인 업무. 있으면 칩을 눌러 그리로 간다. */
  blockedBy?: number | null;
  /** MD-P-2026-025 §B2 — 개인 업무 표시. 없으면 팀 공개로 본다. */
  visibility?: "team" | "private";
  /** §A3 계층 — 없으면 평면 목록으로 그린다(홈 등 compact 사용처는 안 보낸다). */
  parentTaskId?: number | null;
  childCount?: number;
  /** §C — "직접 정한 순서" 값. 정렬은 부모(TasksView)가 이미 해서 넘긴다. */
  sortOrder?: number;
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
  sortable = false,
  onReorder,
  selectable,
  checked,
  onToggleCheck,
  onToggleAll,
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
  /** 다중 선택 (MD-P-2026-027 §D3) — 체크박스 열을 맨 앞에 붙인다 */
  /** §C1 — "직접 정한 순서" 일 때만 true. 그 밖에는 핸들을 그리지 않는다. */
  sortable?: boolean;
  /** §C — 보이는 행의 새 순서. 전역 sort_order 정리는 서버가 한다 (§C3). */
  onReorder?: (parentTaskId: number | null, orderedIds: number[]) => void | Promise<void>;
  selectable?: boolean;
  checked?: Set<number>;
  onToggleCheck?: (id: number) => void;
  onToggleAll?: () => void;
}) {
  const full = variant === "full";
  const colCount = (full ? 9 : 5) + (selectable ? 1 : 0);
  // §H3 — 필터·정렬로 순서가 바뀌면 FLIP 으로 미끄러지고(--dur-3),
  // 목록에서 빠진 행은 한 사이클 붙잡아 두고 사라진다(--dur-2).
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const { rows: shown, exiting } = useExiting(rows);

  // ── §A3 하위 업무 계층 ────────────────────────────────────────────
  //
  // 서버가 상위·하위를 **한 목록**으로 준다(§A3 재귀 처리). 여기서 계층으로 접는다.
  //   · 기본은 접힘. 펼친 상위의 하위만 뒤에 끼워 넣는다.
  //   · 하위가 있는 상위만 캐럿을 갖는다.
  //   · 상위가 목록에 없는 하위(필터로 상위만 빠진 경우)는 제자리에 그대로 둔다 —
  //     숨기면 "검색했는데 안 나온다"가 된다.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // ── §C 드래그 정렬 ────────────────────────────────────────────────
  //
  // 순서는 **같은 부모 안에서만** 바뀐다 (§C3). 다른 부모 위로 끌면 아무 일도 안 한다 —
  // 부모 변경을 같은 제스처에 얹으면 오조작이 난다. 부모는 §A4 의 속성 편집으로 바꾼다.
  // 높이는 애니메이트하지 않는다: 행을 미리 벌리지 않고 **놓일 자리에 1px 선**만 그린다.
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ id: number; after: boolean } | null>(null);

  /** 같은 부모의 형제 id 를 화면 순서대로. 서버가 이 순서를 전역 값으로 정리한다. */
  const siblingIds = (parentId: number | null) =>
    rows.filter((r) => (r.parentTaskId ?? null) === parentId).map((r) => r.id);

  function moveWithin(parentId: number | null, id: number, toIndex: number) {
    const ids = siblingIds(parentId);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(ids.length - 1, toIndex));
    if (to === from) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    void onReorder?.(parentId, ids);
  }

  function dropNow(target: TaskTableRow, after: boolean) {
    const src = rows.find((r) => r.id === dragId);
    setDragId(null); setDropAt(null);
    if (!src || src.id === target.id) return;
    const parentId = src.parentTaskId ?? null;
    // §C3 — 부모가 다르면 순서를 바꾸지 않는다. 조용히 무시한다(되돌릴 것이 없다).
    if ((target.parentTaskId ?? null) !== parentId) return;
    const ids = siblingIds(parentId).filter((x) => x !== src.id);
    const at = ids.indexOf(target.id);
    ids.splice(after ? at + 1 : at, 0, src.id);
    void onReorder?.(parentId, ids);
  }

  const toggleOpen = (id: number) =>
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const childrenOf = new Map<number, TaskTableRow[]>();
  for (const r of shown) {
    const p = r.parentTaskId ?? null;
    if (p === null) continue;
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), r]);
  }
  const present = new Set(shown.map((r) => r.id));
  const nested: TaskTableRow[] = [];
  for (const r of shown) {
    const p = r.parentTaskId ?? null;
    if (p !== null && present.has(p)) continue;   // 펼칠 때 상위 뒤에 끼워 넣는다
    nested.push(r);
    if (expanded.has(r.id)) nested.push(...(childrenOf.get(r.id) ?? []));
  }

  useFlip(bodyRef as unknown as React.RefObject<HTMLElement>, nested.map((r) => r.id).join(","), "tr[data-flip]");
  const [hot, flash] = useHighlight();
  const on = (id: number) => !!checked?.has(id);
  const allOn = selectable && rows.length > 0 && rows.every((r) => on(r.id));
  // 낙관적 완료 — 즉시 반영(페이드) 후 PATCH, 실패 시 롤백
  const [doneLocal, setDoneLocal] = useState<Set<number>>(new Set());
  async function completeNow(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setDoneLocal((s) => new Set(s).add(id));
    flash(`st-${id}`);   // 상태 칸이 바뀌었다는 표시 (§H3 "값이 바뀐 칸")
    toast("완료 처리했어요");
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }),
    });
    if (!res.ok) {
      setDoneLocal((s) => { const n = new Set(s); n.delete(id); return n; });
      toast("완료 처리에 실패했어요", "err");
    } else {
      notifyTaskUpdated();
      notifyGoalChain();   // §H4-② — 사람이 완료를 눌렀다. 목표 트리 연쇄를 예약한다.
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
          {/* §A1 실측 — 폭은 여기(colgroup)가 유일한 출처다. table-layout:fixed 라
              CSS 의 width 는 col 을 못 이긴다. 34px 은 좌우 13px 여백 + 15px 체크박스를
              담지 못해 체크박스가 잘리고 말줄임표가 찍혔다. 68px 은 "우선순위" 머리글과
              알약이 안 들어갔다(필요 79px). 둘 다 들어가는 값으로 올린다. */}
          {selectable && <col style={{ width: "44px" }} />}
          {full ? (
            <>
              <col />
              <col style={{ width: "140px" }} />
              <col style={{ width: "92px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "72px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "124px" }} />
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
            {selectable && (
              <th className="col-chk">
                <input type="checkbox" checked={allOn} onChange={() => onToggleAll?.()}
                  aria-label="전체 선택" disabled={rows.length === 0} />
              </th>
            )}
            <th>업무</th>
            {full && <th>목표</th>}
            {full && <th>영역</th>}
            <th>프로젝트</th>
            <th>담당</th>
            {full && <th className="col-pri">우선순위</th>}
            {full && <th>진행률</th>}
            <th>상태</th>
            <th>기한</th>
          </tr>
        </thead>
        <tbody ref={bodyRef}>
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
          {nested.map((t) => {
            const status = STATUS_LABEL[t.status] ?? { label: t.status, cls: "todo" };
            const kids = childrenOf.get(t.id) ?? [];
            const isChild = (t.parentTaskId ?? null) !== null;
            const openHere = expanded.has(t.id);
            // H-2 — 급함 등급은 lib/task-view 의 dueUrgency 하나에서 나온다.
            // 화면마다 정규식을 따로 쓰면 "이번 주"의 뜻이 화면마다 달라진다.
            const urg = dueUrgency(t.dday);
            const dueCls = urg === "late" ? "bad" : urg === "soon" ? "soon" : "";
            const editable = full && onStatusChange && t.status !== "proposed" && t.status !== "dropped";
            return (
              <tr
                key={t.id}
                data-flip={t.id}
                onClick={onRowClick ? () => onRowClick(t.id) : undefined}
                className={
                  [onRowClick ? "clickable" : "", selectedId === t.id ? "selected" : "",
                   doneLocal.has(t.id) ? "done-opt" : "", exiting.has(t.id) ? "row-out" : "",
                   // §A3 — 하위 행은 들여쓰기 + 나타날 때만 움직인다. 높이는 애니메이트하지 않는다.
                   isChild ? "sub-row" : "",
                   dragId === t.id ? "row-drag" : "",
                   dropAt?.id === t.id ? (dropAt.after ? "drop-after" : "drop-before") : ""]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onDragOver={sortable ? (e) => {
                  if (dragId === null) return;
                  e.preventDefault();
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setDropAt({ id: t.id, after: e.clientY > box.top + box.height / 2 });
                } : undefined}
                onDrop={sortable ? (e) => { e.preventDefault(); dropNow(t, dropAt?.after ?? false); } : undefined}
              >
                {selectable && (
                  <td className="col-chk" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={on(t.id)} onChange={() => onToggleCheck?.(t.id)}
                      aria-label={`${t.title} 선택`} />
                  </td>
                )}
                <td className={isChild ? "sub-cell" : undefined}>
                  {/* §C2 — 6점 그립. hover 와 키보드 포커스에서만 보인다.
                      ⌥↑ / ⌥↓ 로도 한 칸씩 옮긴다 — 드래그만 되면 트랙패드에서 불편하다. */}
                  {sortable && (
                    <button
                      className="dgrip" draggable
                      aria-label={`${t.title} 순서 옮기기`}
                      title="끌어서 옮기기 · ⌥↑ / ⌥↓"
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => { setDragId(null); setDropAt(null); }}
                      onKeyDown={(e) => {
                        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                        e.preventDefault(); e.stopPropagation();
                        const parentId = t.parentTaskId ?? null;
                        const at = siblingIds(parentId).indexOf(t.id);
                        moveWithin(parentId, t.id, at + (e.key === "ArrowUp" ? -1 : 1));
                      }}
                    >
                      <svg viewBox="0 0 10 16" aria-hidden="true">
                        <circle cx="3" cy="3" r="1" /><circle cx="7" cy="3" r="1" />
                        <circle cx="3" cy="8" r="1" /><circle cx="7" cy="8" r="1" />
                        <circle cx="3" cy="13" r="1" /><circle cx="7" cy="13" r="1" />
                      </svg>
                    </button>
                  )}
                  {/* §A3 — 하위가 있는 행의 **왼쪽에만** 캐럿. 없는 행은 자리만 비운다.
                      캐럿을 모든 행에 그리면 무엇이 열리는지 알 수 없다. */}
                  {kids.length > 0 ? (
                    <button
                      className={`sub-cv${openHere ? " on" : ""}`}
                      aria-expanded={openHere}
                      aria-label={`${t.title} 하위 업무 ${openHere ? "접기" : "펼치기"}`}
                      onClick={(e) => { e.stopPropagation(); toggleOpen(t.id); }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                      <span className="num">{kids.length}</span>
                    </button>
                  ) : null}
                  {/* §B3 — 자물쇠 아이콘만으로는 무슨 뜻인지 배워야 한다.
                      기존 상태 칩(.st) 규격을 그대로 쓰고 색만 --amber 틴트다. 코랄은 안 쓴다.
                      원인 업무가 있으면 눌러서 그리로 가고, 없으면 사유를 툴팁으로 보인다. */}
                  {t.blocked && (
                    t.blockedBy ? (
                      <button
                        className="st blkd" title={t.blockedReason ? `막힘: ${t.blockedReason}` : `원인 #${t.blockedBy}`}
                        onClick={(e) => { e.stopPropagation(); onRowClick?.(t.blockedBy!); }}
                      >차단됨</button>
                    ) : (
                      <span className="st blkd" title={t.blockedReason ? `막힘: ${t.blockedReason}` : "막힘"}>차단됨</span>
                    )
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
                  <td className="col-pri">
                    <span className={`prio prio-${t.priority ?? "mid"}`}>
                      {PRIORITY_LABEL[t.priority ?? "mid"] ?? "보통"}
                    </span>
                  </td>
                )}
                {full && (
                  <td className="col-prog">
                    <div className="tt-prog" title={`진행률 ${t.progress ?? 0}%`}>
                      <i className={t.status === "done" ? "pf-green" : "pf-blue"} style={pfill(t.progress ?? 0)} />
                    </div>
                    <ProgPct value={t.progress ?? 0} />
                  </td>
                )}
                <td className={`col-st${hot.has(`st-${t.id}`) ? " hl" : ""}`}>
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
                      <button className="tt-act c" onClick={(e) => completeNow(t.id, e)} title="완료 처리" aria-label="완료 처리">
                        {/* §H3 — 체크마크를 stroke-dashoffset 으로 그린다 (--dur-stroke).
                            글자 ✓ 는 켜지고 꺼질 뿐이고, 그리는 동작이 "지금 됐다"를 말한다. */}
                        <svg className={`chk-draw${doneLocal.has(t.id) ? " on" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3 8.5 L6.5 12 L13 4.5" />
                        </svg>
                      </button>
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

/** 진행률 숫자 — 값이 바뀔 때만 카운트업한다 (§H3, --dur-4). */
function ProgPct({ value }: { value: number }) {
  const n = useCountUp(value);
  return <span className="tt-prog-n">{n}%</span>;
}
