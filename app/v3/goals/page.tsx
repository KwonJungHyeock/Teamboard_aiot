// v3 「목표」 (MD-P-2026-067 §B · 필수 5).
//
// 서버가 하는 일은 **보는 사람이 누구인지** 넘기는 것뿐이다 — 「내 항목」과
// 권한 거르기가 그 번호를 쓴다. 목표는 화면이 `/api/goals` 에서 가져온다.
import { getLiveSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import GoalsView from "@/components/v3/GoalsView";

export const dynamic = "force-dynamic";

export default async function V3Goals() {
  // 스위치와 아홉은 `app/v3/layout.tsx` 가 뿌리에서 막는다 (§0-2).
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  // 걸린 조건이 전부 주소에 담기므로 `useSearchParams` 경계가 필요하다.
  return (
    <Suspense fallback={<p className="v3-loading">불러오는 중…</p>}>
      <GoalsView me={live.user.id} />
    </Suspense>
  );
}
