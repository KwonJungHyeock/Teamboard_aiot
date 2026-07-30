"use client";

// 공통 사이드바 (Phase 2) — 그룹 구조는 SPEC 4.3 + 발주 지시 기준 (프로토타입은 밀도·스타일 참조)
// 그룹: 내 작업 / 목표·보고 / 프로젝트(동적) / 협업 / 관리(lead)
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AreaWithProjects, SessionUser } from "@/lib/types";

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
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  current: boolean;
  count?: number; // 지정 시 우측 카운트 배지 (0이면 회색, >0이면 강조)
}) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      <Icon d={icon} />
      <span>{label}</span>
      {count !== undefined && <span className={`cnt ${count > 0 ? "alert" : ""}`}>{count}</span>}
    </Link>
  );
}

const Chevron = () => (
  <svg className="cv" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export default function Sidebar({
  user,
  areas,
  inboxCount,
  notionConnected = true,
}: {
  user: SessionUser;
  areas: AreaWithProjects[];
  inboxCount: number;
  notionConnected?: boolean;
}) {
  const pathname = usePathname();
  const [rail, setRail] = useState(false);
  const [notif, setNotif] = useState(0);
  // B: 업무 영역 아코디언 — 하위 프로젝트 접기/펼치기. 디폴트 닫힘.
  const [openAreas, setOpenAreas] = useState<Record<number, boolean>>({});
  const toggleArea = (id: number) => setOpenAreas((p) => ({ ...p, [id]: !p[id] }));
  // 활성 하위 항목이 있는 영역은 자동 펼침(사용자 토글은 보존)
  useEffect(() => {
    const active = areas.find((a) => a.projects?.some((p) => pathname.startsWith(`/projects/${p.id}`)));
    if (active) setOpenAreas((prev) => (prev[active.id] ? prev : { ...prev, [active.id]: true }));
  }, [pathname, areas]);

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
        .then((d) => { if (alive) { setNotif(d.unread ?? 0); window.dispatchEvent(new CustomEvent("tb:notif-count", { detail: d.unread ?? 0 })); } })
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

      {/* '오늘' 그룹 평탄화 — 헤더·토글 없이 최상단 평탄 나열 (자주 쓰는 진입점) */}
      <nav className="navtop" aria-label="오늘">
        <NavLink href="/" icon={IC.home} label="홈" current={cur("/")} />
        <NavLink href="/tasks" icon={IC.tasks} label="내 업무" current={cur("/tasks")} />
        <NavLink href="/calendar" icon={IC.calendar} label="캘린더" current={cur("/calendar")} />
        {/* 승인 대기 — 사람/에이전트 공간의 유일한 통로. 카운트 배지 */}
        <NavLink href="/inbox" icon={IC.inbox} label="승인 대기" current={cur("/inbox")} count={inboxCount} />
        {/* 알림 — @멘션·답글·공유 인박스. 미확인 배지 */}
        <NavLink href="/notifications" icon={IC.bell} label="알림" current={cur("/notifications")} count={notif > 0 ? notif : undefined} />
        {/* My Agent — 전 구성원 각자의 에이전트 */}
        <NavLink href="/assistant" icon={IC.bot} label="My Agent" current={cur("/assistant")} />
      </nav>

      <details className="grp" open>
        <summary>
          <SecIcon d={SEC.work} tone="work" />
          <span className="gname">업무 영역</span>
          <Chevron />
        </summary>
        {/* 영역 7종 나열, 각 영역 아래 소속 프로젝트를 들여쓰기로 표시 (is_active=false 는 서버에서 제외) */}
        {areas.map((area) =>
          area.kind === "link_only" ? (
            // link_only — 업무 공간 없이 Notion 링크만 (파트 0). 새 탭.
            <a
              key={area.id}
              className="arealink"
              href={area.notion_url ?? "#"}
              target="_blank"
              rel="noreferrer"
              aria-disabled={area.notion_url ? undefined : true}
              title={area.notion_url ? "Notion에서 열기" : "링크 미설정"}
            >
              <span className={`pjdot ${area.color_key ?? "team"}`} />
              <span>{area.name} <em className="ext-tag">(링크)</em></span>
              <svg className="ext-ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 4h6v6" />
                <path d="M20 4 12 12" />
                <path d="M19 13v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
              </svg>
            </a>
          ) : (
            (() => {
              const hasSub = (area.projects?.length ?? 0) > 0;
              const open = !!openAreas[area.id];
              return (
                <div key={area.id} className="area-grp">
                  <div className="area-row">
                    <Link
                      className="area-link"
                      href={`/areas/${area.id}`}
                      aria-current={pathname === `/areas/${area.id}` ? "page" : undefined}
                    >
                      <span className={`pjdot ${area.color_key ?? "team"}`} />
                      <span>{area.name}</span>
                    </Link>
                    {hasSub && (
                      <button
                        className={`area-cv${open ? " open" : ""}`}
                        onClick={() => toggleArea(area.id)}
                        aria-label={open ? "하위 접기" : "하위 펼치기"}
                        aria-expanded={open}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                      </button>
                    )}
                  </div>
                  {hasSub && open && area.projects.map((project) => (
                    <Link
                      key={project.id}
                      className="subproj"
                      href={`/projects/${project.id}`}
                      aria-current={cur(`/projects/${project.id}`) ? "page" : undefined}
                    >
                      <span className={`pjdot ${project.color_key ?? "team"}`} />
                      <span>{project.name}</span>
                    </Link>
                  ))}
                </div>
              );
            })()
          )
        )}
        <Link className="moreln" href="/projects">
          전체 프로젝트 →
        </Link>
      </details>

      <details className="grp" open>
        <summary>
          <SecIcon d={SEC.goal} tone="goal" />
          <span className="gname">목표 &amp; 성과</span>
          <Chevron />
        </summary>
        <NavLink href="/goals" icon={IC.goal} label="목표" current={cur("/goals")} />
        {isLead && (
          <NavLink href="/reports" icon={IC.report} label="월간 보고" current={cur("/reports")} />
        )}
      </details>

      <details className="grp" open>
        <summary>
          <SecIcon d={SEC.collab} tone="collab" />
          <span className="gname">협업</span>
          <Chevron />
        </summary>
        {/* 시그널 → 표기만 "논의·결정" (코드/테이블은 signal 유지) */}
        <NavLink href="/signals" icon={IC.signal} label="논의·결정" current={cur("/signals")} />
        <NavLink href="/huddle" icon={IC.huddle} label="허들룸" current={cur("/huddle")} />
        <NavLink href="/handover" icon={IC.handover} label="인수인계" current={cur("/handover")} />
      </details>

      {isLead && (
        <details className="grp">
          <summary>
            <SecIcon d={SEC.admin} tone="admin" />
            <span className="gname">관리</span>
            <Chevron />
          </summary>
          <NavLink href="/status" icon={IC.status} label="업무 현황" current={cur("/status")} />
          <NavLink href="/members" icon={IC.members} label="구성원" current={cur("/members")} />
          <NavLink href="/settings" icon={IC.settings} label="설정" current={cur("/settings")} />
          {/* Notion 타임라인 — 미연결이면 숨김 (파트 Z) */}
          {notionConnected && (
            <NavLink
              href="/timeline"
              icon={IC.external}
              label="Notion 타임라인"
              current={cur("/timeline")}
            />
          )}
        </details>
      )}

      <div className="sp" />

      {/* 계정 블록 클릭 → 개별 프로필 (로그아웃은 프로필 화면 상단) */}
      <Link className="acct" href="/profile" aria-current={cur("/profile") ? "page" : undefined} title="내 프로필">
        <span className="av">{user.name.slice(0, 1)}</span>
        <div>
          <b>{user.name}</b>
          <span>{user.role === "lead" ? "LEAD" : user.role.toUpperCase()} · 프로필</span>
        </div>
      </Link>
    </aside>
  );
}
