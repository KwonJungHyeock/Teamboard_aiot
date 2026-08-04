import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import NotionScopeSettings from "@/components/NotionScopeSettings";
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
      <NotionScopeSettings notionConnected={notionConnected} />
    </AppShell>
  );
}
