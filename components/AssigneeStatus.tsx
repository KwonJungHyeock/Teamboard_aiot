// 담당자별 현황 — `/status` 의 담당자 줄 (MD-P-2026-031 §C 회신 1-1).
//
//     이름 · 진행 중 N · 지연 N · 이번 주 마감 N · 막고 있는 것 N
//
// ── 왜 「평균 진척」이 아닌가 ──────────────────────────────────────
//
// 진척은 **본인이 손으로 적는 값**이다. 사람별로 나란히 놓으면
// **정직하게 적을수록 손해**가 된다 — 70% 를 90% 라 적는 사람이 유능해 보이고,
// 그러면 진척 숫자 전체가 못 쓰게 된다.
//
// 여기 넷은 전부 **기한과 관계에서 나오는 사실**이고 본인이 손으로 못 바꾼다.
// 그리고 §C1 판단 타일과 **같은 언어**다 — 홈에서 팀 전체로 보던 것을 사람별로 쪼갠 것이라
// 두 화면이 같은 개념 위에 선다.
//
// ── 0 을 어떻게 쓰는가 ────────────────────────────────────────────
//
// **0 은 「—」로 적는다.** `지연 0` 은 읽는 눈에 숫자로 보이고, 숫자가 넷 나란히 있으면
// 어느 것이 문제인지 세어야 한다. 값이 있는 칸만 숫자로 서면 문제가 먼저 보인다.
// 단 「진행 중」은 0 도 숫자로 적는다 — 그게 그 사람의 상태 자체다.
import Link from "next/link";
import type { HomeSummary } from "@/lib/home";
import SectionEmpty from "./SectionEmpty";

/** 값이 있을 때만 숫자. 없으면 「—」. 위험한 칸(지연·막고 있는 것)은 코랄로 든다. */
function Cell({ n, alert }: { n: number; alert?: boolean }) {
  if (n === 0) return <span className="as-n as-zero">—</span>;
  return <span className={`as-n num${alert ? " as-alert" : ""}`}>{n}</span>;
}

export default function AssigneeStatus({ rows }: { rows: HomeSummary["teamStatus"] }) {
  return (
    <section className="card as-card" aria-label="담당자별 현황">
      <div className="ch">
        <h2>담당자별 현황</h2>
        <span className="sub">진행 중인 업무 기준</span>
      </div>
      {rows.length === 0 ? (
        <SectionEmpty text="진행 중인 업무가 있는 팀원이 없어요" />
      ) : (
        <div className="as-tbl" role="table">
          <div className="as-row as-head" role="row">
            <span role="columnheader">담당자</span>
            <span role="columnheader">진행 중</span>
            <span role="columnheader">지연</span>
            <span role="columnheader">이번 주</span>
            {/* 「막힘」이 아니라 「막고 있는 것」이다 — 이 사람이 원인이라는 뜻이고,
                방향을 흐리면 누구에게 물어야 할지가 사라진다. */}
            <span role="columnheader">막고 있는 것</span>
          </div>
          {rows.map((r) => (
            <Link
              className="as-row click"
              key={r.actorId}
              href={`/tasks?assignee=${r.actorId}`}
              role="row"
            >
              <span className="as-name" role="cell">{r.name}</span>
              <span role="cell"><span className="as-n num">{r.doing}</span></span>
              <span role="cell"><Cell n={r.late} alert /></span>
              <span role="cell"><Cell n={r.thisWeek} /></span>
              <span role="cell"><Cell n={r.blocking} alert /></span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
