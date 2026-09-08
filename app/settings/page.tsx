import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import NotionScopeSettings from "@/components/NotionScopeSettings";
import PlatformSettings from "@/components/PlatformSettings";
import NotionConnection from "@/components/NotionConnection";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant");
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
      <PlatformSettings />
      <NotionScopeSettings notionConnected={notionConnected} />
    </AppShell>
  );
}
