// 업무 테이블 (Phase 3 마감 임박 → Phase 5 공용화) — 홈 "마감 임박"과 /tasks 목록이
// 같은 컴포넌트를 재사용한다 (Phase 5 검수 포인트 6). 컬럼 폭 고정 (프로토타입 colgroup).
// variant="full"(/tasks): 목표·우선순위 컬럼 추가 + 상태 인라인 드롭다운. compact(홈)은 5열 유지.
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
  emptyText = "표시할 업무가 없습니다.",
  onRowClick,
  selectedId,
  variant = "compact",
  onStatusChange,
}: {
  rows: TaskTableRow[];
  title?: string;
  sub?: string;
  emptyText?: string;
  onRowClick?: (id: number) => void;
  selectedId?: number | null;
  variant?: "compact" | "full";
  /** full 전용 — 상태 배지를 드롭다운으로 렌더, 변경 시 호출 */
  onStatusChange?: (id: number, status: string) => void;
}) {
  const full = variant === "full";
  const colCount = full ? 7 : 5;
  return (
    <section className="card" aria-label={title}>
      <div className="ch">
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
      </div>
      <table>
        <colgroup>
          {full ? (
            <>
              <col />
              <col style={{ width: "160px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "104px" }} />
              <col style={{ width: "80px" }} />
            </>
          ) : (
            <>
              <col style={{ width: "44%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "12%" }} />
            </>
          )}
        </colgroup>
        <thead>
          <tr>
            <th>업무</th>
            {full && <th>목표</th>}
            <th>프로젝트</th>
            <th>담당</th>
            {full && <th>우선순위</th>}
            <th>상태</th>
            <th>기한</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} style={{ color: "var(--lo)" }}>
                {emptyText}
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
                  [onRowClick ? "clickable" : "", selectedId === t.id ? "selected" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                <td>{t.title}</td>
                {full && (
                  <td>
                    {t.goalNames && t.goalNames.length > 0 ? t.goalNames.join(", ") : "—"}
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
                {full && <td>{PRIORITY_LABEL[t.priority ?? "mid"] ?? "보통"}</td>}
                <td>
                  {editable ? (
                    <select
                      className="stsel"
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
                <td className={`due ${dueCls}`}>{t.dday ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
