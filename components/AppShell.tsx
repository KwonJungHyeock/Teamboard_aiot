// 공통 셸 (Phase 2) — 배경 레이어 + 사이드바 + 본문 + 커맨드 팔레트
import { redirect } from "next/navigation";
import { getInboxCount } from "@/lib/db";
import { getLiveSession } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import PasswordGate from "./PasswordGate";
import TaskDetailPanel from "./TaskDetailPanel";
import GoalDetailPanel from "./GoalDetailPanel";
import SidePanel from "./SidePanel";
import Shortcuts from "./Shortcuts";
import FirstRun from "./FirstRun";
import AgentFab from "./AgentFab";
import QuickCreate from "./QuickCreate";
import Toaster from "./Toaster";
import TaskSync from "./TaskSync";

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

  // 사이드바에서 영역·프로젝트 트리를 내렸으므로(027 §B2) 그 조인 쿼리도 뺀다.
  // 안 쓰는 데이터를 매 페이지 로드마다 실어 나르지 않는다.
  const inboxCount = await getInboxCount(current.id, current.role === "lead");
  // 파트 Z — Notion 토큰 유무로 관련 UI 자동 분기(미연결 시 숨김)
  const notionConnected = !!process.env.NOTION_TOKEN;
  return (
    <>
      <div className="bgfx" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="app">
        <Sidebar user={current} inboxCount={inboxCount} notionConnected={notionConnected} />
        <main className="main">{children}</main>
      </div>
      <TaskDetailPanel />
      <SidePanel user={current} />
      <GoalDetailPanel />
      <Shortcuts />
      <CommandPalette role={current.role} notionConnected={notionConnected} />
      <AgentFab user={current} />
      <QuickCreate />
      <FirstRun />
      <Toaster />
      <TaskSync />
    </>
  );
}
