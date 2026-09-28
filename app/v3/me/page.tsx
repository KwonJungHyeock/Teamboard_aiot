// v3 「내 정보」 (MD-P-2026-067 §D · 필수 9).
//
// 보여 줄 넷은 **서버가 넘긴다** — 화면이 또 불러오면 레일의 이름표와 이 화면이
// 다른 것을 말할 수 있다. 이메일은 세션 토큰이 아니라 **DB 에서** 읽는다:
// 토큰은 로그인할 때 굳은 값이라 그 뒤에 바뀐 이메일을 모른다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { queryOne } from "@/lib/db";
import { roleLabel } from "@/lib/types";
import { TEAM_NAME } from "@/lib/brand";
import MeView from "@/components/v3/MeView";

export const dynamic = "force-dynamic";

export default async function V3Me() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const row = await queryOne<{ email: string | null }>(
    "SELECT email FROM account WHERE actor_id = $1", [live.user.id]);
  return (
    <MeView
      name={live.user.name}
      email={row?.email ?? ""}
      roleLabel={roleLabel(live.user.role)}
      /* 팀 칸이 아직 없다(§E 승인 대기) — 지금은 팀이 하나뿐이라 앱 이름에서
         온다. 줄마다 다른 값을 지어내지 않는다. */
      team={TEAM_NAME}
    />
  );
}
