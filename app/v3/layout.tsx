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
import { getUiV3 } from "@/lib/v3/switch";
import { deniedHref } from "@/lib/denied";
import { isNine, SWITCH_PATH } from "@/lib/v3/nine";
import { isAdmin } from "@/lib/types";
import { V3_BASE } from "@/lib/v3/routes";
import { notYetHref, notYetOf } from "@/lib/v3/not-yet";
import { PATH_HEADER } from "@/middleware";
import V3Shell from "@/components/v3/Shell";
import "../v3.css";

// 스위치는 **요청마다** 읽는다. 빌드 때 굳으면 끄는 데 배포가 든다 —
// 「되돌리기는 스위치 하나」가 거짓이 된다.
export const dynamic = "force-dynamic";

export default async function V3Layout({ children }: { children: React.ReactNode }) {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  // 등급이 아니라 **스위치**가 막은 것이다 — 이유 문구도 그렇게 말한다.
  if (!(await getUiV3())) {
    /*
     * 074 §A-7 — **켜는 자리도 끄는 자리와 같은 곳이다.** 꺼져 있어도 관리자는
     * 스위치 화면 **하나만** 연다. 그것도 레일 없이 연다 — 꺼진 동안 레일의 다른 곳은
     * 전부 막혀 있어서, 레일을 그리면 누를 수 없는 문이 열 개 선다.
     * 관리자가 아니거나 다른 주소면 예전 그대로 막는다.
     */
    const here0 = (headers().get(PATH_HEADER) ?? "").split("?")[0].replace(/\/+$/, "");
    if (here0 === SWITCH_PATH && isAdmin(live.user)) {
      return <div className="v3 v3-bare"><main className="v3-main">{children}</main></div>;
    }
    redirect(deniedHref("v3-off"));
  }
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
  return <V3Shell user={live.user}>{children}</V3Shell>;
}
