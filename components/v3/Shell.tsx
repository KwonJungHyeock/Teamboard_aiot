"use client";

// v3 껍데기 — 레일 + 본문 (MD-P-2026-042 §B · 051 §A).
//
// 옛 `AppShell` 과 **나란히** 산다. 옛것을 고치지 않는다는 것이 이 회차들의
// 첫째 원칙이라, 상속하거나 감싸지 않고 따로 짓는다. 스위치를 끄면 이 파일은
// 아무 데도 안 닿는다.
//
// 레일 항목은 목업의 탭 순서 그대로다: 오늘 · 업무 · 새 업무 · 캘린더.
// (상세는 업무에서 들어가는 자리라 레일에 없다.)
//
// ── 「＋ 새 업무」가 여기 있는 이유 (051 §A-1) ────────────────────
//
// 두 자리 모두 **껍데기에서 한 번** 그린다. 화면마다 붙이면 하나 빠뜨렸을 때
// 그 화면에서만 없는데 **눌러 보기 전엔 모른다** — 「막는 것은 뿌리에서 한 번
// 한다」(§G 043)와 같은 이유다.
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { V3_BASE } from "@/lib/v3/routes";
import { roleLabel, showsAdminGrantBadge, hasLead } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

const NAV = [
  { href: `${V3_BASE}`, label: "오늘" },
  { href: `${V3_BASE}/tasks`, label: "업무" },
  { href: `${V3_BASE}/new`, label: "새 업무" },
  { href: `${V3_BASE}/calendar`, label: "캘린더" },
];

/**
 * 단축키가 **먹으면 안 되는 자리**.
 *
 * 제목을 치다가 `c` 를 누르면 새 업무 화면으로 끌려간다 — 적던 것이 사라지고,
 * 사라진 이유가 화면 어디에도 안 남는다. 입력에 커서가 있으면 안 건다.
 */
function typing(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  const tag = n.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || n.isContentEditable === true;
}

export default function V3Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // 「오늘」은 정확히 그 경로일 때만 켜진다. `startsWith` 로 하면 전부 켜진다.
  const on = (href: string) => (href === V3_BASE ? pathname === href : pathname.startsWith(href));
  const newHref = `${V3_BASE}/new`;

  const openNew = useCallback(() => { router.push(newHref); }, [router, newHref]);

  // 단축키 `C`. 조합키가 눌려 있으면 안 건다 — ⌘C 는 복사다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "c" || e.key === "C" || e.key === "ㅊ") { e.preventDefault(); openNew(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNew]);

  /*
   * 설정은 **팀장까지**다(`app/settings/page.tsx` 가 `hasLead` 로 막는다).
   * 링크를 모두에게 내면 팀원이 눌렀다가 아무 설명 없이 튕겨 나온다 —
   * 「링크의 조건과 화면의 조건은 같은 함수에서 온다」(§G 038). 같은 함수를 쓴다.
   */
  const canSettings = hasLead(user.role);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  return (
    <div className="v3">
      <div className="v3-app">
        <nav className="v3-rail" aria-label="주 메뉴">
          <span className="v3-rail-brand">
            Eduino AI
            <small>MISSION DECK</small>
          </span>

          {/* 「＋ 새 업무」 — **메뉴보다 위**. 흰 바탕에 파란 글씨라 메뉴와 안 섞인다. */}
          <Link className="v3-railnew" href={newHref}>
            ＋ 새 업무
            <kbd>C</kbd>
          </Link>

          {/* 메뉴 항목에는 제 이름표가 있다. 레일에 「＋ 새 업무」와 계정 링크가
              함께 서면서 「레일의 모든 `a`」가 더는 메뉴를 뜻하지 않게 됐다 —
              세는 쪽이 무엇을 세는지 이름으로 말하게 한다. */}
          {NAV.map((n) => (
            <Link key={n.href} className="v3-navlink" href={n.href}
                  aria-current={on(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}

          {/*
            계정 · 설정 — **바닥 붙박이** (051 §A-2).
            `margin-top:auto` 로 바닥에 붙고, 레일 자체가 sticky 라 목록이 길어도
            같이 밀려 올라가지 않는다.

            역할 배지는 039 에서 정한 그대로다 — `roleLabel` 과
            `showsAdminGrantBadge` 를 **그대로 쓴다.** 「팀장」이면서 「관리자 권한」인
            상태는 한 낱말로 못 적으므로 배지가 둘이다. 새로 만들지 않는다.
          */}
          <div className="v3-acct">
            <Link className="v3-acct-me" href="/profile" title="내 프로필">
              <span className="v3-acct-av">{user.name.slice(0, 1)}</span>
              <span className="v3-acct-nm">
                <b>{user.name}</b>
                <span className="v3-acct-bg">
                  <em>{roleLabel(user.role)}</em>
                  {showsAdminGrantBadge(user) && <em className="grant">관리자 권한</em>}
                </span>
              </span>
            </Link>
            <div className="v3-acct-a">
              {canSettings
                ? <Link className="v3-acct-l" href="/settings">설정</Link>
                // 없는 것을 조용히 빼지 않는다 — **왜 없는지**가 보여야 한다.
                : <span className="v3-acct-l off" title="설정은 팀장부터 볼 수 있습니다">설정</span>}
              <button type="button" className="v3-acct-l" onClick={() => void logout()}>로그아웃</button>
            </div>
          </div>
        </nav>

        <main className="v3-main">
          {/* 헤더 오른쪽의 「＋ 새 업무」 — 파란 채움. 레일의 것과 **같은 곳**으로 간다. */}
          <div className="v3-top">
            <Link className="v3-btn primary v3-topnew" href={newHref}>＋ 새 업무</Link>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
