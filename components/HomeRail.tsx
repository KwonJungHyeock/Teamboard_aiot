"use client";

// 홈 오른쪽 레일 (MD-P-2026-031 §C3 3층) — 320px, 스크롤은 본문과 독립.
//
// **레일이 §B1 의 빈 가로 공간을 회수하는 장치다. 레일을 빼면 §B1 위반이 다시 난다.**
//
// 구성은 셋뿐이다 (회신 2-4).
//   ① 팀 활동      — 팀이 방금 무엇을 했는가. 내 것만이 아니다.
//   ② 내 목표 진척 — **본문은 업무를, 레일은 목표를 보여준다.** 둘이 같은 것을 말하면
//                    레일을 둘 이유가 없다.
//   ③ 최근 본 것   — 복귀 도구. 어제 보던 업무로 한 번에 돌아가는 것.
//
// 「다가오는 일정」은 여기 없다. 소스가 개인 캘린더 하나뿐이라 대부분 빈 카드가 됐다.
// 032 허들룸 재설계에서 「회의 1건 = 세션 1개」가 선 뒤에 다시 본다.
//
// **업무 상태는 레일에 넣지 않는다** — 개수가 아니라 종류로 적용되는 규칙이다.
// 본문 2층이 이미 업무 상태를 말한다.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import { encodeRefs, pruneRecent, recentRefs, type RecentItem } from "@/lib/recent";
import { progressDisplay } from "@/lib/progress";
import { openTaskPanel } from "@/lib/task-panel";
import { pfill } from "@/lib/progress-bar";
import SectionEmpty from "./SectionEmpty";

/** 레일 블록 한 벌. 본문 블록(.hm-blk)과 **다른 규격**이다 — 폭이 절반이라 머리줄이 더 낮다. */
function RailBlock({ title, more, moreHref, children }: {
  title: string; more?: string; moreHref?: string; children: React.ReactNode;
}) {
  return (
    <section className="rl-blk" aria-label={title}>
      <div className="rl-h">
        <h2>{title}</h2>
        {more && moreHref && <Link className="rl-more" href={moreHref}>{more}</Link>}
      </div>
      {children}
    </section>
  );
}

/** 시각 — `14:32`. 날짜는 안 적는다. 레일은 「방금」을 보는 곳이고, 폭이 320px 이다. */
function hhmm(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export default function HomeRail({ activity, myGoals, myGoalCount, user }: {
  activity: HomeSummary["teamActivity"];
  myGoals: HomeSummary["myGoals"];
  myGoalCount: number;
  user: SessionUser;
}) {
  return (
    <aside className="hm-rail" aria-label="레일">
      {/* ── ① 팀 활동 ─────────────────────────────────────────────
          「오늘의 활동」이 아니다. 날짜 조건을 걸면 조용한 날에 빈 카드가 된다.
          거르는 것도 묶는 것도 서버가 한다(lib/activity-roll.ts). */}
      <RailBlock title="팀 활동" more="전체 →" moreHref="/inbox">
        {activity.length === 0
          ? <SectionEmpty text="아직 기록된 활동이 없어요" />
          : activity.map((a) => (
            <button
              key={a.id}
              className="rl-act"
              onClick={() => a.taskId && openTaskPanel(a.taskId)}
              disabled={!a.taskId}
            >
              <span className="rl-act-t">
                {a.userName && <b>{a.userName}</b>}
                {a.text}
                {/* `1회` 는 정보가 아니다 — 묶인 것만 개수를 적는다. */}
                {a.count > 1 && <em className="rl-act-n num">{a.count}건</em>}
              </span>
              <span className="rl-act-at num">{hhmm(a.at)}</span>
            </button>
          ))}
      </RailBlock>

      {/* ── ② 내 목표 진척 ────────────────────────────────────────
          진척 표기는 `progressDisplay()` 한 함수에서 나온다 — 목표 화면과 같은 말을 해야 한다.
          표본이 1~2건이면 막대를 그리지 않는다(MIN_SAMPLE). 여기서 다시 판정하지 않는다. */}
      <RailBlock title="내 목표 진척" more="전체 →" moreHref="/goals?scope=personal">
        {myGoals.length === 0
          ? <SectionEmpty
              text={myGoalCount > 0 ? "지금 기간에 걸친 목표가 없어요" : "내 목표를 만들어 보세요"}
              action={{ label: "목표 →", href: "/goals?scope=personal" }} />
          : myGoals.map((g) => {
            // 값도 막대도 분모도 전부 이 한 함수가 정한다 — 목표 화면과 같은 말을 해야 한다.
            const d = progressDisplay(g.progress, g.counted);
            return (
              <Link className="rl-goal" key={g.id} href={`/goals?panel=goal:${g.id}`}>
                <span className="rl-goal-h">
                  <span className="rl-goal-lv">{g.level}</span>
                  <span className="rl-goal-t">{g.title}</span>
                  {/* 표본이 부족해도 **값은 보이고 흐리다** — 감추지 않는다(30-1·2). */}
                  <em className={`rl-goal-p num${d.lowConfidence ? " low" : ""}`}>
                    {d.hasValue ? `${g.progress}%` : "—"}
                  </em>
                </span>
                <span className="rl-goal-track">
                  {d.drawBar && <i style={pfill(g.progress ?? 0)} />}
                </span>
                {/* 숫자만 있고 분모가 없는 진척은 화면에 두지 않는다 (§G). */}
                {d.basis && <span className="rl-goal-base">{d.basis}</span>}
              </Link>
            );
          })}
      </RailBlock>

      {/* ── ③ 최근 본 것 ──────────────────────────────────────── */}
      <RecentBlock user={user} />
    </aside>
  );
}

/**
 * 최근 본 것 (§C3 ④).
 *
 * 브라우저에는 **종류와 id 만** 있다. 제목은 서버가 그때그때 권한을 보고 준다.
 * 그래서 이 블록만 클라이언트에서 한 번 더 물어본다 — 서버 렌더에 얹을 수 없는 값이다
 * (localStorage 는 서버에 없다). 첫 그림에서는 아무것도 그리지 않는다.
 */
function RecentBlock({ user }: { user: SessionUser }) {
  const [items, setItems] = useState<RecentItem[] | null>(null);

  const load = useCallback(async () => {
    const refs = recentRefs(user.id);
    if (refs.length === 0) { setItems([]); return; }
    try {
      const res = await fetch(`/api/meta/recent?items=${encodeURIComponent(encodeRefs(refs))}`);
      if (!res.ok) { setItems([]); return; }
      const data: { items: RecentItem[] } = await res.json();
      setItems(data.items);
      // 서버가 못 찾은 것은 저장소에서도 뺀다 — 안 빼면 매번 묻고 매번 빠진다.
      pruneRecent(user.id, data.items);
    } catch {
      // 복귀 도구가 홈을 죽이면 안 된다. 조용히 빈 목록으로 둔다.
      setItems([]);
    }
  }, [user.id]);

  useEffect(() => { void load(); }, [load]);

  return (
    <RailBlock title="최근 본 것">
      {items === null
        ? <div className="rl-skel" aria-hidden="true" />
        : items.length === 0
          ? <SectionEmpty text="최근 본 것이 아직 없어요" />
          : items.slice(0, 6).map((it) => (
            <Link className="rl-recent" key={`${it.kind}:${it.id}`} href={it.href}>
              <span className="rl-recent-k">{it.label}</span>
              <span className="rl-recent-t">{it.title}</span>
            </Link>
          ))}
    </RailBlock>
  );
}
