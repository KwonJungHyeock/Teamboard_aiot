"use client";

// 공통 사이드바 — 세 묶음 (MD-P-2026-027 §B1)
//
//   내 공간 : 내 업무 · 내 목표 · 메모 · 내 캘린더 · 저장됨  (+ 저장된 뷰 핀)
//   팀     : 홈 · 목표 · 프로젝트 · 업무 · 캘린더 · 타임라인 · 논의·결정 ·
//            허들룸 · 활동 · 승인 대기 · 월간 보고
//   관리   : 구성원 · 업무 현황 · 인수인계 · 내 에이전트     ← 기본 접힘
//   하단   : 계정 · 프로필 · 설정 · 로그아웃
//
// 설정은 「관리」에 두지 않는다 (§B 회신 B1-a). 팀장 전용이 아닌데
// 「관리」가 기본 접힘이라 팀원이 못 찾는다. 계정 블록이 개인 설정의 자리다.
// Notion 타임라인도 「관리」가 아니다 (B1-b) — 업무 일정을 보는 팀 기능이다.
//
// **업무 영역 7개를 사이드바에서 뺐다** (§B2). 영역은 "어디로 갈까"가 아니라
// "무엇을 볼까"라서 /tasks 필터 칩이 맞는 자리다. 사이드바가 데이터 개수만큼
// 길어지면 내비게이션이 아니라 목록이 된다.
// 프로젝트 트리도 같은 이유로 내렸다 — 「팀 › 프로젝트」 한 줄로 들어간다.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { SessionUser } from "@/lib/types";
import { viewHref, type SavedView } from "@/lib/saved-views";
import { SAVED_VIEWS_EVENT } from "@/lib/saved-views-events";

const RAIL_KEY = "tb.rail";

// 아이콘 — 프로토타입과 동일한 인라인 SVG 스트로크 방식 (금지1: 일러스트·로고는 그리지 않음)
const IC = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  tasks: (
    <>
      <path d="M9 11l2 2 4-4" />
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4M9 14h.01M15 14h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13h4l2 3h4l2-3h4" />
      <path d="M4 13 6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    </>
  ),
  goal: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  report: (
    <>
      <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  signal: <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />,
  bookmark: <path d="M6 3h12v18l-6-4.5L6 21V3Z" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  huddle: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M3 19c0-2.8 2.7-5 6-5s6 2.2 6 5M16 19c0-1.6.5-2.6 1.4-3.4" />
    </>
  ),
  members: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </>
  ),
  status: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M20 20V8" />
      <path d="M3 20h18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>
  ),
  project: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  handover: (
    <>
      <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 15h6M12 12v6M9.5 14.5 12 12l2.5 2.5" />
    </>
  ),
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {d}
    </svg>
  );
}

// 그룹 섹션 아이콘 — wayfinding용(색 절제 예외). 라인 아이콘, 라이트 톤.
const SEC = {
  work: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  goal: <path d="M4 20V11M10 20V4M16 20v-6M3 20h18" />,
  collab: (
    <>
      <circle cx="8" cy="9" r="2.6" />
      <circle cx="16" cy="9" r="2.6" />
      <path d="M2.5 19c0-2.6 2.4-4.5 5.5-4.5M21.5 19c0-2.6-2.4-4.5-5.5-4.5" />
    </>
  ),
  admin: <path d="M12 3l7 2.6v5.6c0 4-3 6.9-7 8-4-1.1-7-4-7-8V5.6z" />,
};

function SecIcon({ d, tone }: { d: React.ReactNode; tone: string }) {
  return (
    <span className={`gico g-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">{d}</svg>
    </span>
  );
}

function NavLink({
  href,
  icon,
  label,
  current,
  count,
  dot,
  soon,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  current: boolean;
  count?: number; // 지정 시 우측 카운트 배지 (0이면 회색, >0이면 강조)
  dot?: boolean;  // 숫자 없는 작은 점 — 시스템 알림용 (MD-P-2026-007 §B)
  soon?: boolean; // 자리만 잡아둔 메뉴 (MD-P-2026-025 §C·§D) — 누를 수 없다
}) {
  // 자리만 잡아둔 메뉴는 링크가 아니다. 누르면 아무 데도 안 가는 링크가 더 나쁘다.
  if (soon) {
    return (
      <span className="navsoon" aria-disabled="true" title="다음 단계에서 열립니다">
        <Icon d={icon} />
        <span>{label}</span>
        <em>준비 중</em>
      </span>
    );
  }
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      <Icon d={icon} />
      <span>{label}</span>
      {dot && <span className="navdot" title="새 시스템 알림" />}
      {count !== undefined && <span className={`cnt ${count > 0 ? "alert" : ""}`}>{count}</span>}
    </Link>
  );
}

/** 핀에 붙는 화면 표시 — 같은 이름의 뷰가 화면마다 있을 수 있어 어느 화면 것인지 밝힌다. */
const VIEW_TARGET_LABEL: Record<SavedView["target"], string> = {
  tasks: "업무", goals: "목표", activity: "활동",
};

const Chevron = () => (
  <svg className="cv" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export default function Sidebar({
  user,
  inboxCount,
  notionConnected = true,
}: {
  user: SessionUser;
  inboxCount: number;
  notionConnected?: boolean;
}) {
  const pathname = usePathname();
  // "내 목표"와 "목표"는 같은 화면의 다른 탭이다 — 어느 쪽이 켜졌는지 쿼리로 가른다.
  const sp = useSearchParams();
  const tab = sp.get("tab");
  // "캘린더"와 "내 캘린더"는 같은 화면의 레이어 차이다 — 어느 쪽이 켜졌는지 쿼리로 가른다.
  const mineParam = sp.get("mine");
  const [rail, setRail] = useState(false);
  const [notif, setNotif] = useState(0);         // 사람 안읽음 (배지 숫자)
  const [sysNotif, setSysNotif] = useState(0);  // 시스템 안읽음 (점만)
  // 저장된 뷰 — 「내 공간」 아래 핀으로 붙는다 (§B3). 항상 개인이다.
  const [views, setViews] = useState<SavedView[]>([]);
  const [dragId, setDragId] = useState<number | null>(null);

  const loadViews = useCallback(() => {
    fetch("/api/saved-views")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setViews((d.views ?? []).filter((v: SavedView) => v.isPinned)))
      .catch(() => {});
  }, []);
  useEffect(() => { loadViews(); }, [loadViews]);
  useEffect(() => {
    window.addEventListener(SAVED_VIEWS_EVENT, loadViews);
    return () => window.removeEventListener(SAVED_VIEWS_EVENT, loadViews);
  }, [loadViews]);

  /** 드래그로 순서 변경 — 놓는 순간 전체 순서를 한 번에 보낸다. */
  function dropOn(targetId: number) {
    if (dragId === null || dragId === targetId) return;
    const next = views.slice();
    const from = next.findIndex((v) => v.id === dragId);
    const to = next.findIndex((v) => v.id === targetId);
    if (from < 0 || to < 0) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    setViews(next);                      // 낙관적 — 놓자마자 자리가 잡혀야 한다
    setDragId(null);
    fetch("/api/saved-views", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((v) => v.id) }),
    }).catch(() => loadViews());         // 실패하면 서버 값으로 되돌린다
  }

  useEffect(() => {
    const saved = localStorage.getItem(RAIL_KEY) === "1";
    setRail(saved);
    document.body.classList.toggle("rail", saved);
  }, []);

  // 미확인 알림 수 — 상시 폴링 + 읽음 이벤트 시 즉시 갱신. FAB와 같은 소스로 동기.
  useEffect(() => {
    let alive = true;
    const fetchCount = () =>
      fetch("/api/notifications")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          // 배지 숫자 = 사람 안읽음만. 시스템은 점으로만 알린다 (MD-P-2026-007 §B).
          setNotif(d.unread ?? 0);
          setSysNotif(d.systemUnread ?? 0);
          window.dispatchEvent(new CustomEvent("tb:notif-count", { detail: d.unread ?? 0 }));
        })
        .catch(() => {});
    fetchCount();
    const t = setInterval(fetchCount, 8000);
    const onChanged = () => fetchCount();
    window.addEventListener("tb:notif-changed", onChanged);
    return () => { alive = false; clearInterval(t); window.removeEventListener("tb:notif-changed", onChanged); };
  }, []);

  function toggleRail() {
    const next = !rail;
    setRail(next);
    document.body.classList.toggle("rail", next);
    localStorage.setItem(RAIL_KEY, next ? "1" : "0");
  }

  function openPalette() {
    window.dispatchEvent(new CustomEvent("tb:open-palette"));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  const isLead = user.role === "lead";
  const cur = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="side">
      <div className="brand">
        {/* Eduino AI 로고 — 다크 표면이므로 ondark 마크(점=라이트). 레일 접힘 시 마크만. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mk-logo" src="/brand/eduino_mark_ondark.png" alt="Eduino AI" width={30} height={21} />
        <div className="nm">
          Eduino AI
          <small>MISSION DECK</small>
        </div>
        <button className="tg" onClick={toggleRail} aria-label="사이드바 접기">
          <svg viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
      </div>

      <button className="kbar" onClick={openPalette} aria-label="검색 및 이동 (Cmd+K)">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span>검색 및 이동</span>
        <kbd>⌘K</kbd>
      </button>

      {/* ── 내 공간 (MD-P-2026-025 §A1 · 027 §B1) ───────────────────
          무언가 적을 때마다 "이걸 올리면 남들이 보나?"를 판단하지 않아도 되도록
          경계를 **메뉴로** 보인다. 여기 있는 것은 기본적으로 내 것이다. */}
      <nav className="navgrp" aria-label="내 공간">
        <div className="navgrp-l">내 공간</div>
        <NavLink href="/tasks" icon={IC.tasks} label="내 업무"
          current={cur("/tasks") && sp.get("assignee") !== "all"} />
        <NavLink href="/goals?tab=personal" icon={IC.goal} label="내 목표"
          current={pathname === "/goals" && tab === "personal"} />
        <NavLink href="/notes" icon={IC.report} label="메모" current={cur("/notes")} />
        <NavLink href="/calendar?mine=1" icon={IC.calendar} label="내 캘린더"
          current={pathname === "/calendar" && mineParam === "1"} />
        <NavLink href="/saved" icon={IC.bookmark} label="저장됨" current={cur("/saved")} />

        {/* 저장된 뷰 핀 (§B3) — 항상 개인이다. 공유 옵션을 만들지 않는다.
            드래그로 순서를 바꾼다. 놓는 순간 전체 순서를 한 번에 저장한다. */}
        {views.length > 0 && (
          <div className="pinviews" role="list" aria-label="저장된 뷰">
            {views.map((v) => (
              <div
                key={v.id}
                role="listitem"
                className={`pinview${dragId === v.id ? " dragging" : ""}`}
                draggable
                onDragStart={() => setDragId(v.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(v.id)}
              >
                <Link href={viewHref(v)} title={`${VIEW_TARGET_LABEL[v.target]} · ${v.name}`}>
                  <span className="pinview-t">{VIEW_TARGET_LABEL[v.target]}</span>
                  <span className="pinview-n">{v.name}</span>
                </Link>
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* ── 팀 ──────────────────────────────────────────────────────
          홈은 여기다. 홈은 팀 전체 현황판이지 개인 화면이 아니다(§A1). */}
      <nav className="navgrp" aria-label="팀">
        <div className="navgrp-l">팀</div>
        <NavLink href="/" icon={IC.home} label="홈" current={cur("/")} />
        <NavLink href="/goals" icon={IC.goal} label="목표"
          current={pathname === "/goals" && tab !== "personal"} />
        {/* 프로젝트 — 예전에는 영역 아래 트리로 펼쳐 놨다. 사이드바가 데이터 개수만큼
            길어지면 내비게이션이 아니라 목록이 된다 (§B2). 여기서는 입구만 준다. */}
        <NavLink href="/projects" icon={IC.project} label="프로젝트" current={cur("/projects")} />
        {/* 업무 — 담당 필터 없이 팀 전체. 「내 업무」와 같은 화면의 다른 조건이다.
            빈 파라미터(`?assignee=`)가 아니라 **명시값**을 쓴다 (B-12).
            빈 값은 "지정 안 함"과 "전체"를 구별하지 못하고, 주소도 지저분하다. */}
        <NavLink href="/tasks?assignee=all" icon={IC.tasks} label="업무"
          current={cur("/tasks") && sp.get("assignee") === "all"} />
        <NavLink href="/calendar" icon={IC.calendar} label="캘린더"
          current={pathname === "/calendar" && mineParam !== "1"} />
        {/* 타임라인 — 업무 일정을 보는 팀 기능이다 (B1-b). 캘린더 옆이 자리다.
            토큰이 없으면 서버가 "/" 로 튕기므로 **메뉴 자체를 그리지 않는다** —
            눌러도 홈으로 돌아오는 링크를 남기지 않는다. */}
        {notionConnected && (
          <NavLink href="/timeline" icon={IC.external} label="타임라인" current={cur("/timeline")} />
        )}
        <NavLink href="/signals" icon={IC.signal} label="논의·결정" current={cur("/signals")} />
        <NavLink href="/huddle" icon={IC.huddle} label="허들룸" current={cur("/huddle")} />
        {/* 활동 — @멘션·답글·공유 인박스. 미확인 배지 */}
        <NavLink href="/activity" icon={IC.bell} label="활동" current={cur("/activity")}
          count={notif > 0 ? notif : undefined} dot={notif === 0 && sysNotif > 0} />
        {/* 승인 대기 — 사람/에이전트 공간의 유일한 통로 */}
        <NavLink href="/inbox" icon={IC.inbox} label="승인 대기" current={cur("/inbox")} count={inboxCount} />
        <NavLink href="/reports" icon={IC.report} label="월간 보고" current={cur("/reports")} />
      </nav>

      {/* ── 관리 (기본 접힘) ─────────────────────────────────────────
          매일 쓰는 것이 아니다. 펼쳐 두면 위 두 묶음이 밀린다. */}
      <details className="grp">
        <summary>
          <SecIcon d={SEC.admin} tone="admin" />
          <span className="gname">관리</span>
          <Chevron />
        </summary>
        {isLead && (
          <>
            <NavLink href="/members" icon={IC.members} label="구성원" current={cur("/members")} />
            <NavLink href="/status" icon={IC.status} label="업무 현황" current={cur("/status")} />
          </>
        )}
        <NavLink href="/handover" icon={IC.handover} label="인수인계" current={cur("/handover")} />
        <NavLink href="/assistant" icon={IC.bot} label="내 에이전트" current={cur("/assistant")} />
      </details>

      <div className="sp" />

      {/* 계정 블록 — 이름 · 프로필 · 설정 · 로그아웃 한 덩어리 (B1-a).
          설정은 팀장 전용이 아니다. 「관리」가 기본 접힘이라 거기 있으면 팀원이 못 찾는다.
          개인에 관한 것은 개인 자리에 둔다. */}
      <div className="acctblk">
        <Link className="acct" href="/profile" aria-current={cur("/profile") ? "page" : undefined} title="내 프로필">
          <span className="av">{user.name.slice(0, 1)}</span>
          <div>
            <b>{user.name}</b>
            <span>{user.role === "lead" ? "LEAD" : user.role.toUpperCase()}</span>
          </div>
        </Link>
        <div className="acct-a">
          <Link className="acct-l" href="/profile" aria-current={cur("/profile") ? "page" : undefined}>프로필</Link>
          <Link className="acct-l" href="/settings" aria-current={cur("/settings") ? "page" : undefined}>설정</Link>
          <button className="acct-l" onClick={logout}>로그아웃</button>
        </div>
      </div>
    </aside>
  );
}
