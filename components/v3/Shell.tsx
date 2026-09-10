"use client";

// v3 껍데기 — 레일 + 본문 (MD-P-2026-042 §B).
//
// 옛 `AppShell` 과 **나란히** 산다. 옛것을 고치지 않는다는 것이 이번 회차의
// 첫째 원칙이라, 상속하거나 감싸지 않고 따로 짓는다. 스위치를 끄면 이 파일은
// 아무 데도 안 닿는다.
//
// 레일 항목은 목업의 탭 순서 그대로다: 오늘 · 업무 · 새 업무 · 캘린더.
// (상세는 업무에서 들어가는 자리라 레일에 없다.)
import Link from "next/link";
import { usePathname } from "next/navigation";
import { V3_BASE } from "@/lib/v3/routes";
import { roleLabel, showsAdminGrantBadge } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

const NAV = [
  { href: `${V3_BASE}`, label: "오늘" },
  { href: `${V3_BASE}/tasks`, label: "업무" },
  { href: `${V3_BASE}/new`, label: "새 업무" },
  { href: `${V3_BASE}/calendar`, label: "캘린더" },
];

export default function V3Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname();
  // 「오늘」은 정확히 그 경로일 때만 켜진다. `startsWith` 로 하면 전부 켜진다.
  const on = (href: string) => (href === V3_BASE ? pathname === href : pathname.startsWith(href));

  return (
    <div className="v3">
      <div className="v3-app">
        <nav className="v3-rail" aria-label="주 메뉴">
          <span className="v3-rail-brand">
            Eduino AI
            <small>MISSION DECK</small>
          </span>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={on(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
          <div className="v3-rail-foot">
            {user.name} · {roleLabel(user.role)}
            {showsAdminGrantBadge(user) && " · 관리자 권한"}
          </div>
        </nav>
        <main className="v3-main">{children}</main>
      </div>
    </div>
  );
}
