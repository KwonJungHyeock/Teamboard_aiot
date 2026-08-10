// 홈 대시보드 (Phase 3) — 구 /control 4요소 흡수 대상 화면
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { buildHomeSummary } from "@/lib/home";
import AppShell from "@/components/AppShell";
import HomeView from "@/components/HomeView";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = getSession();
  if (!user) redirect("/login");
  const summary = await buildHomeSummary(user.id, user.role === "lead");
  // 기간(`?span`)은 저장값이 없다 — **주소가 전부라서 서버가 답을 안다.**
  // 넘겨주면 첫 렌더부터 맞는 칩이 켜진다. 안 넘기면 하이드레이션이 끝날 때까지
  // 「이번 분기」가 켜진 채로 보인다 (실측에서 잡혔다).
  const span = searchParams?.span;
  return (
    <AppShell user={user}>
      <HomeView summary={summary} user={user} initialSpan={typeof span === "string" ? span : undefined} />
    </AppShell>
  );
}
