// 공통 셸 (Phase 2) — 배경 레이어 + 사이드바 + 본문 + 커맨드 팔레트
import { getActiveProjects, queryOne } from "@/lib/db";
import type { SessionUser } from "@/lib/types";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import PasswordGate from "./PasswordGate";

export default async function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  // 최초 로그인 비밀번호 변경 강제 (Phase 8) — 모든 인증 페이지가 AppShell을 거치므로 여기서 한 번만 가드
  const status = await queryOne<{ must_change_pw: boolean }>(
    "SELECT must_change_pw FROM account WHERE actor_id = $1",
    [user.id]
  );
  if (status?.must_change_pw) {
    return (
      <>
        <div className="bgfx" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <PasswordGate name={user.name} />
      </>
    );
  }

  const projects = await getActiveProjects();
  return (
    <>
      <div className="bgfx" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="app">
        <Sidebar user={user} projects={projects} />
        <main className="main">{children}</main>
      </div>
      <CommandPalette role={user.role} />
    </>
  );
}
