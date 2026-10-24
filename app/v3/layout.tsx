// v3 경로 뿌리 — **스위치가 꺼져 있으면 여기 못 들어온다** (MD-P-2026-042 §B).
//
// ── 왜 레이아웃에서 막는가 ──────────────────────────────────────
//
// 화면마다 막으면 하나 빠뜨렸을 때 **꺼진 상태에서도 열리는 화면**이 하나 생기고,
// 그건 눌러 보기 전엔 안 보인다. 뿌리에 한 번 걸면 아래는 전부 걸린다.
//
// 「막은 사람이 가는 곳도 한 곳에서 낸다」(§G) — `DENIED_HREF` 로 보낸다.
// 스위치가 꺼진 것은 권한 문제가 아니지만, **갈 곳은 같아야 한다**: 로그인한
// 누구나 볼 수 있는 화면. 두 개를 두면 목적지가 사라질 때 고칠 자리가 둘이 된다.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { isNine } from "@/lib/v3/nine";
import { V3_BASE } from "@/lib/v3/routes";
import { notYetHref, notYetOf } from "@/lib/v3/not-yet";
import { PATH_HEADER } from "@/middleware";
import Frame from "@/components/ed/Frame";
import { hasLead, isAdmin, roleLabel } from "@/lib/types";

// 스위치는 **요청마다** 읽는다. 빌드 때 굳으면 끄는 데 배포가 든다 —
// 「되돌리기는 스위치 하나」가 거짓이 된다.
export const dynamic = "force-dynamic";

export default async function V3Layout({ children }: { children: React.ReactNode }) {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  /*
   * 2026-10 옛 화면 철거 — 새 화면 스위치를 거뒀다. 새 화면이 **유일한 화면**이라
   * 켜고 끌 것이 없다(옛 주소는 `middleware.ts` 가 새 화면으로 보낸다).
   */
  /*
   * ── 067 §0-2 — **아홉 밖의 v3 주소는 전부 막음 화면으로 간다** ────
   *
   * 화면마다 막으면 하나 빠뜨렸을 때 **아홉이 아닌데 열리는 화면**이 하나 생기고,
   * 그건 눌러 보기 전엔 안 보인다. 스위치를 뿌리에서 막는 것과 같은 판단이다.
   *
   * 목록(`NINE`)을 여기서 또 적지 않는다 — 레일과 **같은 파일**에서 온다.
   * 두 벌이 되면 「레일에 없는데 열리는」 자리가 생긴다(§G 066).
   */
  const here = headers().get(PATH_HEADER) ?? "";
  if (here && !isNine(here)) {
    /*
     * 이름을 아는 곳이면 **그 이름으로** 보낸다 — `/v3/calendar` 는 「캘린더」다.
     * 모르는 곳이면 열쇠 없이 보낸다: 막음 화면이 주소에 적힌 글자를 그대로
     * 화면에 옮기지 않는다(`notYetOf` 가 모르는 열쇠에 `null` 을 낸다).
     */
    const first = here.replace(`${V3_BASE}/`, "").split("?")[0].split("/")[0];
    redirect(notYetOf(first) ? notYetHref(first) : `${V3_BASE}/not-yet`);
  }
  const u = live.user;
  const lead = hasLead(u.role) || u.adminGrant;
  const admin = isAdmin(u);
  const user = { id: u.id, name: u.name, lead, admin, roleLabel: `${roleLabel(u.role)}${u.adminGrant && u.role !== "admin" ? " · 관리자 권한" : ""}` };
  return <Frame user={user}>{children}</Frame>;
}
