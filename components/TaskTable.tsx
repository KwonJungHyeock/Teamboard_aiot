// 마감 임박 테이블 (Phase 3) — 컬럼 폭 고정 (프로토타입 colgroup 그대로)
import type { HomeSummary } from "@/lib/home";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  proposed: { label: "제안", cls: "prop" },
  todo: { label: "대기", cls: "todo" },
  doing: { label: "진행", cls: "doing" },
  review: { label: "리뷰", cls: "review" },
  done: { label: "완료", cls: "done" },
  dropped: { label: "중단", cls: "drop" },
};

export default function TaskTable({ rows }: { rows: HomeSummary["dueSoon"] }) {
  return (
    <section className="card" aria-label="마감 임박 업무">
      <div className="ch">
        <h2>마감 임박</h2>
        <span className="sub">7일 이내 · {rows.length}건</span>
      </div>
      <table>
        <colgroup>
          <col style={{ width: "44%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>업무</th>
            <th>프로젝트</th>
            <th>담당</th>
            <th>상태</th>
            <th>기한</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--lo)" }}>
                7일 이내 마감 업무가 없습니다.
              </td>
            </tr>
          )}
          {rows.map((t) => {
            const status = STATUS_LABEL[t.status] ?? { label: t.status, cls: "todo" };
            const dueCls = t.overdue ? "bad" : t.dday === "D-DAY" || t.dday === "D-1" || t.dday === "D-2" ? "soon" : "";
            return (
              <tr key={t.id}>
                <td>{t.title}</td>
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
                <td>
                  <span className={`st ${status.cls}`}>{status.label}</span>
                </td>
                <td className={`due ${dueCls}`}>{t.dday}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
