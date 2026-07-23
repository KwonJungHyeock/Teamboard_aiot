// 홈 대시보드 (Phase 3) — 구 /control 4요소 흡수 대상 화면
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { buildHomeSummary } from "@/lib/home";
import AppShell from "@/components/AppShell";
import HomeView from "@/components/HomeView";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = getSession();
  if (!user) redirect("/login");
  const summary = await buildHomeSummary(user.id);
  return (
    <AppShell user={user}>
      <HomeView summary={summary} user={user} />
    </AppShell>
  );
}
