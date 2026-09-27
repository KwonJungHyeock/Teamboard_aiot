import { redirect } from "next/navigation";
import { getUiV3 } from "@/lib/v3/switch";
import { notYetForOld, notYetHref } from "@/lib/v3/not-yet";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import AppShell from "@/components/AppShell";
import ProfileView from "@/components/ProfileView";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = getSession();
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
    const blocked = notYetForOld("/profile");
    if (blocked) redirect(notYetHref(blocked.key));
  }
  if (!user) redirect("/login");
  const row = await queryOne<{ short_name: string | null }>(
    "SELECT short_name FROM actor WHERE id = $1",
    [user.id]
  );
  return (
    <AppShell user={user}>
      <ProfileView user={user} initialShortName={row?.short_name ?? ""} />
    </AppShell>
  );
}
