// 공통 셸 (Phase 2) — 배경 레이어 + 사이드바 + 본문 + 커맨드 팔레트
import { redirect } from "next/navigation";
import { getActiveProjects } from "@/lib/db";
import { getLiveSession } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import PasswordGate from "./PasswordGate";

export default async function AppShell({
  user,
  children,
}: {
  // user는 페이지의 토큰 세션. 실제 렌더는 아래 라이브 세션(실시간 role·활성)을 사용한다.
  user: SessionUser;
  children: React.ReactNode;
}) {
  // 라이브 세션 가드 (Phase 9) — 모든 인증 페이지가 AppShell을 거치므로 여기서 단일 처리.
  // 한 번의 조회로 is_active·role·must_change_pw를 반영한다.
  const live = await getLiveSession();
  if (!live) {
    // 비활성/무효 세션 → 쿠키 삭제 후 로그인으로 (GET 로그아웃 라우트가 사유 전달)
    redirect("/api/auth/logout?reason=inactive");
  }
  const current = live.user; // 실시간 role 반영 (승격·강등 즉시)

  // 최초 로그인 비밀번호 변경 강제 (Phase 8)
  if (live.mustChangePassword) {
    return (
      <>
        <div className="bgfx" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <PasswordGate name={current.name} />
      </>
    );
  }

  const projects = await getActiveProjects();
  return (
    <>
      <div className="bgfx" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="app">
        <Sidebar user={current} projects={projects} />
        <main className="main">{children}</main>
      </div>
      <CommandPalette role={current.role} />
    </>
  );
}
