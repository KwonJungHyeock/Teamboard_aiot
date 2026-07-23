"use client";

// 월간 보고 화면 (Phase 7) — SPEC 3.2의 6개 섹션 고정 순서.
// 수치·목록은 서버 집계(data)에서, 서술 문단은 narration에서 온다. 화면은 계산하지 않는다.
export interface ReportData {
  year: number;
  month: number;
  periodLabel: string;
  goals: { id: number; title: string; progress: number | null; projectName: string | null; droppedCount: number }[];
  completed: { id: number; title: string; goalTitles: string[]; assigneeName: string | null }[];
  incomplete: { id: number; title: string; dueDate: string | null; assigneeName: string | null }[];
  dropped: { id: number; title: string; dropReason: string | null }[];
  decisions: { id: number; title: string; status: string }[];
  pendingDecisions: { id: number; title: string; decidedAt: string | null; decidedElapsedDays?: number | null }[];
  risks: { id: number; title: string; status: string }[];
  nextGoals: { id: number; title: string }[];
  nextTasks: { id: number; title: string; dueDate: string | null }[];
  counts: {
    goals: number;
    completed: number;
    incomplete: number;
    dropped: number;
    decisions: number;
    pendingDecisions: number;
    risks: number;
    nextGoals: number;
    nextTasks: number;
  };
}

const pct = (n: number | null) => (n === null ? "-" : `${n}%`);

function Prose({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return <p className="rp-prose">{text}</p>;
}

/** 렌더 항목 수와 집계 count를 대조 — 불일치 시 경고 배너 (조용한 누락 방지, 치명1 조치) */
function CountGuard({ expected, rendered, label }: { expected: number; rendered: number; label: string }) {
  if (expected === rendered) return null;
  return (
    <p className="rp-warn" role="alert">
      ⚠ {label}: 집계 {expected}건 중 {rendered}건만 표시됨 — 데이터 확인 필요
    </p>
  );
}

export default function ReportView({
  data,
  narration,
}: {
  data: ReportData;
  narration: Record<string, string>;
}) {
  return (
    <div className="rp">
      <h1 className="rp-title">{data.periodLabel} 월간 보고</h1>

      <section className="rp-sec">
        <h2>1. 이번 달 목표 달성 현황</h2>
        <Prose text={narration.goals} />
        <CountGuard expected={data.counts.goals} rendered={data.goals.length} label="목표" />
        {data.goals.length === 0 ? (
          <p className="rp-empty">해당 월 목표가 없습니다.</p>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th>목표</th>
                <th>프로젝트</th>
                <th>진척</th>
              </tr>
            </thead>
            <tbody>
              {data.goals.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.title}
                    {g.droppedCount > 0 && <em className="rp-drop"> 중단 {g.droppedCount}건</em>}
                  </td>
                  <td>{g.projectName ?? "—"}</td>
                  <td>{pct(g.progress)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rp-sec">
        <h2>2. 주요 수행 실적</h2>
        <Prose text={narration.completed} />
        <CountGuard expected={data.counts.completed} rendered={data.completed.length} label="완료 업무" />
        {data.completed.length === 0 ? (
          <p className="rp-empty">완료한 업무가 없습니다.</p>
        ) : (
          <ul className="rp-list">
            {data.completed.map((t) => (
              <li key={t.id}>
                {t.title}
                {t.goalTitles.length > 0 && <em className="rp-tag"> [{t.goalTitles.join(", ")}]</em>}
                {t.assigneeName && <span className="rp-by"> · {t.assigneeName}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rp-sec">
        <h2>3. 미달 항목 및 사유</h2>
        <Prose text={narration.incomplete} />
        <CountGuard expected={data.counts.incomplete} rendered={data.incomplete.length} label="미완료" />
        <CountGuard expected={data.counts.dropped} rendered={data.dropped.length} label="중단" />
        {data.incomplete.length === 0 && data.dropped.length === 0 ? (
          <p className="rp-empty">미달·중단 항목이 없습니다.</p>
        ) : (
          <ul className="rp-list">
            {data.incomplete.map((t) => (
              <li key={`i${t.id}`}>
                <span className="rp-mk mk-inc">미완료</span> {t.title}
                {t.dueDate && <span className="rp-by"> · 기한 {t.dueDate}</span>}
              </li>
            ))}
            {data.dropped.map((t) => (
              <li key={`d${t.id}`}>
                <span className="rp-mk mk-drop">중단</span> {t.title}
                <span className="rp-by"> · {t.dropReason ?? "사유 미기재"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rp-sec">
        <h2>4. 주요 결정 사항</h2>
        <Prose text={narration.decisions} />
        <CountGuard expected={data.counts.decisions} rendered={data.decisions.length} label="결정" />
        {data.decisions.length === 0 ? (
          <p className="rp-empty">결정 사항이 없습니다.</p>
        ) : (
          <ul className="rp-list">
            {data.decisions.map((s) => (
              <li key={s.id}>
                {s.title}
                <span className="rp-by"> · {s.status === "resolved" ? "반영됨" : "결정됨"}</span>
              </li>
            ))}
          </ul>
        )}
        {data.pendingDecisions.length > 0 && (
          <div className="rp-pending">
            <b>미실행 결정 (결정됐으나 업무로 반영되지 않음)</b>
            <CountGuard
              expected={data.counts.pendingDecisions}
              rendered={data.pendingDecisions.length}
              label="미실행 결정"
            />
            <ul className="rp-list">
              {data.pendingDecisions.map((s) => (
                <li key={s.id}>
                  {s.title}
                  <span className="rp-by">
                    {" · "}
                    {s.decidedAt ? s.decidedAt.slice(0, 10) : "?"} 결정
                    {s.decidedElapsedDays != null ? `, ${s.decidedElapsedDays}일 경과` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rp-sec">
        <h2>5. 리스크 및 이슈</h2>
        <Prose text={narration.risks} />
        <CountGuard expected={data.counts.risks} rendered={data.risks.length} label="리스크" />
        {data.risks.length === 0 ? (
          <p className="rp-empty">리스크가 없습니다.</p>
        ) : (
          <ul className="rp-list">
            {data.risks.map((s) => (
              <li key={s.id}>
                {s.title}
                <span className="rp-by"> · {s.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rp-sec">
        <h2>6. 다음 달 목표 및 계획</h2>
        <Prose text={narration.next} />
        <CountGuard expected={data.counts.nextGoals} rendered={data.nextGoals.length} label="다음 달 목표" />
        <CountGuard expected={data.counts.nextTasks} rendered={data.nextTasks.length} label="다음 달 예정 업무" />
        {data.nextGoals.length === 0 && (
          <p className="rp-empty">다음 달 목표가 아직 설정되지 않았습니다. 목표 화면에서 설정하세요.</p>
        )}
        {data.nextGoals.length === 0 && data.nextTasks.length === 0 ? (
          <p className="rp-empty">등록된 다음 달 예정 업무도 없습니다.</p>
        ) : (
          <ul className="rp-list">
            {data.nextGoals.map((g) => (
              <li key={`g${g.id}`}>
                <span className="rp-mk mk-goal">목표</span> {g.title}
              </li>
            ))}
            {data.nextTasks.map((t) => (
              <li key={`t${t.id}`}>
                <span className="rp-mk mk-task">예정</span> {t.title}
                {t.dueDate && <span className="rp-by"> · {t.dueDate}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
