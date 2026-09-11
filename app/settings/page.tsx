import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import NotionScopeSettings from "@/components/NotionScopeSettings";
import PlatformSettings from "@/components/PlatformSettings";
import NotionConnection from "@/components/NotionConnection";
import { hasLead, isAdmin } from "@/lib/types";
import { deniedHref } from "@/lib/denied";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // v3 스위치가 여기 있고 그건 **관리자만** 바꾼다. 관리자인지는 토큰이 아니라
  // DB 의 지금 값으로 봐야 권한 회수가 즉시 먹는다(039).
  const live = await getLiveSession();
  if (!live) redirect("/login");
  const user = live.user;
  if (!hasLead(user.role)) redirect(deniedHref("settings"));
  const notionConnected = !!process.env.NOTION_TOKEN;
  return (
    <AppShell user={user}>
      <div className="hv">
        <div className="top"><div className="crumb">워크스페이스 / <b>설정</b></div><span className="sp" /></div>
        <div className="wrap">
          {/* Notion 연결 상태 (MD-P-2026-012 §B) */}
          <NotionConnection />
        </div>
      </div>
      {/* 플랫폼 설정을 **위에** 둔다 — 가오픈까지 자주 만지는 값이고,
          Notion 연결은 한 번 하고 마는 값이다. */}
      <PlatformSettings isAdmin={isAdmin(user)} />
      <NotionScopeSettings notionConnected={notionConnected} />
    </AppShell>
  );
}
