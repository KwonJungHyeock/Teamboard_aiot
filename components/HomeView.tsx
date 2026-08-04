"use client";

// 홈 대시보드 (Phase 3) — SPEC 4.1의 6요소를 프로토타입 레이아웃 그대로 조립.
// ③ "이번 달 목표 진척"은 SPEC 우선 규칙에 따라 프로토타입의 "프로젝트 진행" 자리를 대체.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import EmptyState from "./EmptyState";
import NewMenu from "./NewMenu";
import HeroTimeline from "./HeroTimeline";

// 실시간 시계 (Mission Deck 헤더) — KST, 모노. 매초 갱신.
function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="clock" aria-label="현재 시각 (KST)">
      <span className="clock-t">{now || "--:--:--"}</span>
      <span className="clock-z">KST</span>
    </span>
  );
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false })
      .format(new Date())
  );
  if (hour < 6) return "늦은 밤이에요";
  if (hour < 12) return "좋은 아침이에요";
  if (hour < 18) return "좋은 오후예요";
  return "좋은 저녁이에요";
}

export default function HomeView({
  summary,
  user,
}: {
  summary: HomeSummary;
  user: SessionUser;
}) {
  const [anchor, setAnchor] = useState<string>(summary.today);

  const dateLabel = useMemo(() => {
    const d = new Date(`${summary.today}T00:00:00+09:00`);
    const dow = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay() === undefined ? 0 : new Date(`${summary.today}T12:00:00+09:00`).getDay()];
    return `${summary.today.replace(/-/g, ".")} ${dow}`;
  }, [summary.today]);

  function openPalette() {
    window.dispatchEvent(new CustomEvent("tb:open-palette"));
  }

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>홈</b>
        </div>
        <span className="sp" />
        <button className="iconbtn" onClick={openPalette} aria-label="검색">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </button>
        <NewMenu />
      </div>

      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">{dateLabel} · 플랫폼팀</div>
            <h1>
              {greeting()}, {summary.greetingName || user.name}님
            </h1>
            <p>{summary.greetingSub}</p>
          </div>
          <div className="head-r">
            <Clock />
          </div>
        </div>

        <div className="home3">
          {/* Row1 — Q3 목표 / 다가오는 일정 */}
          <div className="hrow r13">
            <GoalsModule annual={summary.annualGoals} quarter={summary.quarterGoals} annualLabel={summary.annualLabel} quarterLabel={summary.quarterLabel} />
            <Upcoming items={summary.upcoming} />
          </div>

          {/* Row2 — 히어로 타임라인 (요약 ⇄ 상세) */}
          <HeroTimeline
            lanes={summary.lanes}
            today={summary.today}
            anchor={anchor}
            onAnchorChange={setAnchor}
          />

          {/* Row3 — 결정 대기 / 나의 초점 */}
          <div className="hrow r13">
            <DecisionsWaiting items={summary.decisionsWaiting} decidedThisWeek={summary.decisionsThisWeek} />
            <MyFocus items={summary.myFocus} agent={summary.agent} />
          </div>
        </div>
      </div>
    </div>
  );
}


// ── 홈 재편 모듈 (테마 재편 §3) ──
const GOAL_STATUS: Record<string, { color: string; label: string }> = {
  risk: { color: "var(--coral)", label: "리스크" },
  ontrack: { color: "var(--green)", label: "온트랙" },
  wait: { color: "var(--slate)", label: "대기" },
};

function GoalsModule({ annual, quarter, annualLabel, quarterLabel }: {
  annual: HomeSummary["annualGoals"]; quarter: HomeSummary["quarterGoals"]; annualLabel: string; quarterLabel: string;
}) {
  const empty = annual.length === 0 && quarter.length === 0;
  return (
    <section className="tile mod" aria-label="목표 달성 현황">
      <div className="th"><h3>목표</h3><Link className="m gmore" href="/goals">전체 관리 →</Link></div>
      {empty ? (
        <EmptyState compact title="등록된 목표가 없어요" hint="연간·분기 목표를 추가하면 달성 현황이 모입니다." action={<Link className="btn small primary" href="/goals">목표 추가</Link>} />
      ) : (
        <>
          {/* 연간 — 큰 게이지 */}
          <div className="gm-sec-l">연간 · {annualLabel}</div>
          {annual.length === 0 ? (
            <Link className="gm-empty" href="/goals">＋ 올해 연간 목표를 추가하세요</Link>
          ) : annual.map((g) => (
            <Link className="ann-row" key={g.id} href="/goals">
              <div className="ann-top"><span className="ann-t">{g.title}</span><span className="ann-pct num">{g.progress === null ? "-" : `${g.progress}%`}</span></div>
              <div className="ann-track"><i style={{ width: `${Math.max(g.progress ?? 0, 2)}%`, background: "var(--blue)" }} /></div>
            </Link>
          ))}
          {/* 분기 — 리스트 */}
          <div className="gm-sec-l">분기 · {quarterLabel.split(" ")[1] ?? quarterLabel}</div>
          {quarter.length === 0 ? (
            <Link className="gm-empty" href="/goals">＋ 이번 분기 목표를 추가하세요</Link>
          ) : (
            <div className="qg">
              {quarter.map((g) => {
                const st = GOAL_STATUS[g.status];
                return (
                  <Link className="qg-row" key={g.id} href="/goals">
                    <div className="qg-top">
                      <span className="qg-t">{g.title}</span>
                      <span className="qg-chip" style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 14%, var(--card))` }}>{st.label}</span>
                    </div>
                    <div className="qg-bar">
                      <div className="qg-track"><i style={{ width: `${Math.max(g.progress ?? 0, 2)}%`, background: st.color }} /></div>
                      <span className="qg-pct num">{g.progress === null ? "-" : `${g.progress}%`}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const UP_KIND: Record<string, { label: string; color: string }> = {
  meeting: { label: "회의", color: "var(--blue)" },
  review: { label: "리뷰", color: "var(--amber)" },
  deadline: { label: "마감", color: "var(--coral)" },
};
function Upcoming({ items }: { items: HomeSummary["upcoming"] }) {
  return (
    <section className="tile mod" aria-label="다가오는 일정">
      <div className="th"><h3>다가오는 일정</h3></div>
      {items.length === 0 ? (
        <EmptyState compact title="예정된 일정이 없어요" hint="회의·마감이 14일 안에 잡히면 여기에 모입니다." />
      ) : (
        <div className="up">
          {items.map((it) => {
            const k = UP_KIND[it.kind];
            const [, mm, dd] = it.date.split("-");
            return (
              <Link className="up-row" key={it.key} href={it.kind === "meeting" ? "/calendar" : `/tasks`}>
                <span className="up-date"><b className="num">{Number(mm)}-{Number(dd)}</b></span>
                <span className="up-b">
                  <span className="up-t">{it.title}</span>
                  <span className="up-chip" style={{ color: k.color, background: `color-mix(in srgb, ${k.color} 14%, var(--card))` }}>{k.label}</span>
                </span>
                {it.dday && <span className={`up-dd num${it.overdue ? " over" : ""}`}>{it.dday}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DecisionsWaiting({ items, decidedThisWeek }: { items: HomeSummary["decisionsWaiting"]; decidedThisWeek: number }) {
  return (
    <section className="tile mod" aria-label="결정 대기">
      <div className="th"><h3>결정 대기</h3><span className="m">논의중 {items.length}</span></div>
      {items.length === 0 ? (
        <EmptyState compact title="대기 중인 결정이 없어요" hint="논의중인 결정이 여기에 오래된 순으로 쌓입니다." action={<Link className="btn small" href="/signals">논의·결정으로</Link>} />
      ) : (
        <div className="dw">
          {items.map((d) => (
            <Link className={`dw-row${d.alert ? " alert" : ""}`} key={d.id} href={`/signals?signal=${d.id}`}>
              <span className="dw-dot" style={{ background: d.alert ? "var(--coral)" : "var(--slate)" }} />
              <span className="dw-b">
                <span className="dw-t">{d.title}</span>
                <span className="dw-meta">{d.authorName} · 답글 {d.commentCount}</span>
              </span>
              <span className={`dw-age num${d.alert ? " over" : ""}`}>{d.ageDays}일</span>
            </Link>
          ))}
        </div>
      )}
      {/* 이번 주 확정된 결정 — 카운터 아님, 한 줄 링크 (MD-P-2026-004 §D) */}
      <Link className="dw-week" href="/signals?tab=decision">
        이번 주 확정된 결정 <b className="num">{decidedThisWeek}</b>건 →
      </Link>
    </section>
  );
}

const FOCUS_IC: Record<string, { color: string; glyph: string }> = {
  mention: { color: "var(--purple)", glyph: "@" },
  approval: { color: "var(--coral)", glyph: "!" },
  task: { color: "var(--teal)", glyph: "◱" },
};
function focusTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function MyFocus({ items, agent }: { items: HomeSummary["myFocus"]; agent: HomeSummary["agent"] }) {
  const AS: Record<string, { label: string; cls: string }> = {
    working: { label: "작업 중", cls: "working" },
    pending: { label: "보고 대기", cls: "pending" },
    idle: { label: "대기", cls: "idle" },
  };
  const a = AS[agent.status];
  return (
    <section className="tile mod focus" aria-label="나의 초점">
      <div className="th"><h3>나의 초점</h3></div>
      {items.length === 0 ? (
        <EmptyState compact title="지금 처리할 것이 없어요" hint="멘션·승인·오늘 마감이 생기면 여기에 모입니다." />
      ) : (
        <div className="mf">
          {items.map((f) => {
            const ic = FOCUS_IC[f.kind];
            return (
              <Link className="mf-row" key={f.key} href={f.href}>
                <span className="mf-ic" style={{ color: ic.color, background: `color-mix(in srgb, ${ic.color} 15%, var(--card))` }}>{ic.glyph}</span>
                <span className="mf-t">{f.summary}</span>
                {f.time && <span className="mf-time num">{focusTime(f.time)}</span>}
              </Link>
            );
          })}
        </div>
      )}
      {/* 에이전트 상태 칩 — 실사용량 연동 */}
      <Link className={`agchip s-${a.cls}`} href="/assistant" aria-label={`에이전트 ${a.label}`}>
        <span className={`agchip-led ${a.cls}`} aria-hidden="true" />
        <span className="agchip-l">에이전트 {a.label}</span>
        <span className="agchip-tok num">{agent.spentTokens.toLocaleString()} tok · ₩{agent.won.toLocaleString()}</span>
      </Link>
    </section>
  );
}
