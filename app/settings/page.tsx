import { redirect } from "next/navigation";
import { getUiV3 } from "@/lib/v3/switch";
import { notYetForOld, notYetHref } from "@/lib/v3/not-yet";
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
  /*
   * 066 §B-9 — **주소로 직접 들어와도 막는다.**
   *
   * 옛 셸(`AppShell`)이 이미 같은 일을 하지만, 이 화면은 **제 등급 문턱이 먼저
   * 걸린다.** 팀원이 주소를 치면 셸에 닿기 전에 「밀려남」으로 튕겨서, 067 까지
   * 막아 두기로 한 화면이 사람에 따라 다른 곳으로 갔다.
   *
   * 그래서 **문턱보다 위**에서 한 번 묻는다. 목록과 목적지는 같은 파일에서
   * 온다(`lib/v3/not-yet.ts`) — 067 에서 그 줄을 지우면 이 길도 함께 풀린다.
   */
  if (await getUiV3()) {
    const blocked = notYetForOld("/settings");
    if (blocked) redirect(notYetHref(blocked.key));
  }
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
