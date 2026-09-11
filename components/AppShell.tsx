// 공통 셸 (Phase 2) — 배경 레이어 + 사이드바 + 본문 + 커맨드 팔레트
import { redirect } from "next/navigation";
import { getInboxCount } from "@/lib/db";
import { getLiveSession } from "@/lib/auth";
import { headers } from "next/headers";
import { getUiV3 } from "@/lib/v3/switch";
import { v3Destination } from "@/lib/v3/routes";
import { PATH_HEADER } from "@/middleware";
import { hasLead } from "@/lib/types";
import type { SessionUser } from "@/lib/types";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import PasswordGate from "./PasswordGate";
import TaskDetailPanel from "./TaskDetailPanel";
import NewTaskModal from "./NewTaskModal";
import GoalDetailPanel from "./GoalDetailPanel";
import SidePanel from "./SidePanel";
import Shortcuts from "./Shortcuts";
import FirstRun from "./FirstRun";
import QuickCreate from "./QuickCreate";
import Toaster from "./Toaster";
import TaskSync from "./TaskSync";
import DeniedNote from "./DeniedNote";
import { Suspense } from "react";

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
  const inboxCount = await getInboxCount(current.id, hasLead(current.role));
  // 파트 Z — Notion 토큰 유무로 관련 UI 자동 분기(미연결 시 숨김)
  const notionConnected = !!process.env.NOTION_TOKEN;
  /*
   * v3 스위치 (042 §B) — **꺼져 있으면 이 값 말고는 아무것도 달라지지 않는다.**
   * 옛 화면을 고치지 않는다는 원칙 때문에, 옛 셸이 새 껍데기로 가는 길 하나만
   * 안다. 링크·나머지 항목은 §C 에서 화면이 생길 때 `ROUTE_PAIRS` 로 옮긴다.
   */
  const uiV3 = await getUiV3();
  /*
   * 켜졌으면 **여기 한 곳에서** 새 경로로 보낸다.
   *
   * 옛 화면 수십 곳의 `href` 를 고치는 것은 이번 회차의 첫째 원칙(기존 화면을
   * 고치지 않는다)을 정면으로 어긴다. 그래서 링크는 그대로 두고 **도착한 자리**
   * 에서 보낸다. 모든 로그인 화면이 이 셸을 지나므로 자리는 하나다.
   *
   * `ROUTE_PAIRS` 에 짝이 없으면 안 보낸다 — 아직 v3 에 없는 화면은 옛것으로
   * 그대로 뜬다. 없는 곳으로 보내는 것보다 옛 화면이 낫다.
   */
  if (uiV3) {
    const to = v3Destination(headers().get(PATH_HEADER) ?? "");
    if (to) redirect(to);
  }
  return (
    <>
      <div className="bgfx" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="app">
        <Sidebar user={current} inboxCount={inboxCount} notionConnected={notionConnected} uiV3={uiV3} />
        <main className="main">
          {/* 밀려난 이유 — **도착한 화면 위에** 선다 (053 §B-31).
              `DENIED_HREF` 가 어디로 바뀌든 모든 로그인 화면이 이 셸을 지나므로
              자리는 하나다. `useSearchParams` 는 Suspense 경계를 요구한다. */}
          <Suspense fallback={null}><DeniedNote /></Suspense>
          {children}
        </main>
      </div>
      <TaskDetailPanel user={current} />
      {/* 만드는 자리(모달)와 고치는 자리(패널)를 나눈다 — MD-P-2026-027 §C */}
      <NewTaskModal user={current} />
      <SidePanel user={current} />
      <GoalDetailPanel user={current} />
      <Shortcuts />
      <CommandPalette role={current.role} notionConnected={notionConnected} />
      <QuickCreate />
      <FirstRun />
      <Toaster />
      <TaskSync />
    </>
  );
}
