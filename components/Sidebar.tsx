"use client";

// 공통 사이드바 (Phase 2) — 그룹 구조는 SPEC 4.3 + 발주 지시 기준 (프로토타입은 밀도·스타일 참조)
// 그룹: 내 작업 / 목표·보고 / 프로젝트(동적) / 협업 / 관리(lead)
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Project, SessionUser } from "@/lib/types";

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
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {d}
    </svg>
  );
}

function NavLink({
  href,
  icon,
  label,
  current,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  current: boolean;
}) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      <Icon d={icon} />
      <span>{label}</span>
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
  projects,
}: {
  user: SessionUser;
  projects: Project[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [rail, setRail] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(RAIL_KEY) === "1";
    setRail(saved);
    document.body.classList.toggle("rail", saved);
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
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isLead = user.role === "lead";
  const cur = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const shownProjects = projects.slice(0, 5);

  return (
    <aside className="side">
      <div className="brand">
        <div className="mk">EB</div>
        <div className="nm">
          팀보드<small>EDUINO PLATFORM</small>
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

      <details className="grp" open>
        <summary>
          <Chevron />
          <span className="gname">내 작업</span>
        </summary>
        <NavLink href="/" icon={IC.home} label="홈" current={cur("/")} />
        <NavLink href="/tasks" icon={IC.tasks} label="내 업무" current={cur("/tasks")} />
        <NavLink href="/calendar" icon={IC.calendar} label="캘린더" current={cur("/calendar")} />
        <NavLink href="/assistant" icon={IC.bot} label="내 부사수" current={cur("/assistant")} />
      </details>

      <details className="grp" open>
        <summary>
          <Chevron />
          <span className="gname">목표·보고</span>
        </summary>
        <NavLink href="/goals" icon={IC.goal} label="목표" current={cur("/goals")} />
        {isLead && (
          <NavLink href="/reports" icon={IC.report} label="월간 보고" current={cur("/reports")} />
        )}
      </details>

      <details className="grp" open>
        <summary>
          <Chevron />
          <span className="gname">프로젝트</span>
        </summary>
        {shownProjects.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            aria-current={cur(`/projects/${project.id}`) ? "page" : undefined}
          >
            <span className={`pjdot ${project.color_key ?? "team"}`} />
            <span>{project.name}</span>
          </Link>
        ))}
        {/* 인덱스 진입 경로는 항상 노출, 직접 나열만 5개 제한 (발주 지시) */}
        <Link className="moreln" href="/projects">
          전체 프로젝트 →
        </Link>
      </details>

      <details className="grp" open>
        <summary>
          <Chevron />
          <span className="gname">협업</span>
        </summary>
        <NavLink href="/signals" icon={IC.signal} label="시그널" current={cur("/signals")} />
        <NavLink href="/huddle" icon={IC.huddle} label="허들" current={cur("/huddle")} />
      </details>

      {isLead && (
        <details className="grp">
          <summary>
            <Chevron />
            <span className="gname">관리</span>
          </summary>
          <NavLink href="/members" icon={IC.members} label="구성원" current={cur("/members")} />
          <NavLink href="/settings" icon={IC.settings} label="설정" current={cur("/settings")} />
          <NavLink
            href="/timeline"
            icon={IC.external}
            label="Notion 타임라인"
            current={cur("/timeline")}
          />
        </details>
      )}

      <div className="sp" />

      <button className="acct" onClick={logout} title="로그아웃">
        <span className="av">{user.name.slice(0, 1)}</span>
        <div>
          <b>{user.name}</b>
          <span>{user.role === "lead" ? "LEAD" : user.role.toUpperCase()} · 로그아웃</span>
        </div>
      </button>
    </aside>
  );
}
