// 공통 셸 (Phase 2) — 배경 레이어 + 사이드바 + 본문 + 커맨드 팔레트
import { getActiveProjects } from "@/lib/db";
import type { SessionUser } from "@/lib/types";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";

export default async function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
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
