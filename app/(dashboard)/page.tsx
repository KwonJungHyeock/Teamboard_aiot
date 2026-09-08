// 홈 대시보드 (Phase 3) — 구 /control 4요소 흡수 대상 화면
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { buildHomeSummary } from "@/lib/home";
import { getPlatformOpen } from "@/lib/platform-config";
import AppShell from "@/components/AppShell";
import HomeView from "@/components/HomeView";
import { hasLead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = getSession();
  if (!user) redirect("/login");
  // 카운트다운은 **목표 시각만** 서버가 정한다. 남은 시간은 보는 사람의 시계가 센다 —
  // 서버에서 세면 SSR 값과 클라이언트 값이 어긋나고, 그건 초 단위로 눈에 띈다.
  const [summary, open] = await Promise.all([
    buildHomeSummary(user.id, hasLead(user.role)),
    getPlatformOpen(),
  ]);
  // 기간(`?span`)은 저장값이 없다 — **주소가 전부라서 서버가 답을 안다.**
  // 넘겨주면 첫 렌더부터 맞는 칩이 켜진다. 안 넘기면 하이드레이션이 끝날 때까지
  // 「이번 분기」가 켜진 채로 보인다 (실측에서 잡혔다).
  const span = searchParams?.span;
  return (
    <AppShell user={user}>
      <HomeView
        summary={summary}
        user={user}
        initialSpan={typeof span === "string" ? span : undefined}
        open={open}
      />
    </AppShell>
  );
}
