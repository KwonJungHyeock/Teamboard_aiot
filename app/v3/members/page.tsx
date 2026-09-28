// v3 「구성원」 (MD-P-2026-067 §C · 필수 8).
//
// ── 권한이 없으면 **막음 화면이 아니다** (§C-18) ─────────────────
//
// 「아홉에 들어 있다」와 「누구에게나 보인다」는 다른 말이다. 이 화면은 아홉에
// 들지만 **관리자만** 본다. 권한이 없는 사람은 레일에 이 항목이 없고(같은 함수로
// 가린다), 주소로 들어오면 **밀려남**으로 간다 — 「아직 안 여는 것」이 아니라
// 「내 등급으로는 못 보는 것」이기 때문이다. 두 말을 섞으면 읽는 사람이
// 「기다리면 열리나?」로 잘못 읽는다.
//
// 이유 문구는 `lib/denied.ts` 의 표 하나에서 나온다 (053 §B-31).
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/types";
import { deniedHref } from "@/lib/denied";
import MembersView from "@/components/v3/MembersView";

export const dynamic = "force-dynamic";

export default async function V3Members() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  // **DB 의 지금 값**으로 본다 — 토큰으로 보면 권한 회수가 늦게 먹는다(039).
  if (!isAdmin(live.user)) redirect(deniedHref("members"));
  return <MembersView me={live.user.id} />;
}
