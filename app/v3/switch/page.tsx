// 새 화면 스위치 — **열 번째** 필수 (MD-P-2026-074 §A).
//
// 켜면 옛 「설정」이 막음 화면 뒤로 가서 끄는 버튼이 숨었다(073 §C). 이 자리는
// 새 화면 **안에서** 끄고, 꺼진 뒤에도 **같은 자리에서** 다시 켠다(뿌리가 관리자에게만
// 열어 둔다 — `app/v3/layout.tsx`).
//
// **관리자만.** 권한은 토큰이 아니라 DB 의 지금 값으로 본다(039). 관리자가 아니면
// 화면을 그리기 전에 밀어낸다 — 화면이 API 를 부르지도 않는다(규약 6-3).
// 바꾸는 일은 있는 `PUT /api/settings/platform { uiV3 }` 가 한다. 새 API 는 없다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/types";
import { deniedHref } from "@/lib/denied";
import { getUiV3 } from "@/lib/v3/switch";
import SwitchView from "@/components/v3/SwitchView";

export const dynamic = "force-dynamic";

export default async function V3Switch() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (!isAdmin(live.user)) redirect(deniedHref("v3-switch"));
  return <SwitchView on={await getUiV3()} />;
}
