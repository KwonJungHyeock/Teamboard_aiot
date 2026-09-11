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
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { getUiV3 } from "@/lib/v3/switch";
import { deniedHref } from "@/lib/denied";
import V3Shell from "@/components/v3/Shell";
import "../v3.css";

// 스위치는 **요청마다** 읽는다. 빌드 때 굳으면 끄는 데 배포가 든다 —
// 「되돌리기는 스위치 하나」가 거짓이 된다.
export const dynamic = "force-dynamic";

export default async function V3Layout({ children }: { children: React.ReactNode }) {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  // 등급이 아니라 **스위치**가 막은 것이다 — 이유 문구도 그렇게 말한다.
  if (!(await getUiV3())) redirect(deniedHref("v3-off"));
  return <V3Shell user={live.user}>{children}</V3Shell>;
}
