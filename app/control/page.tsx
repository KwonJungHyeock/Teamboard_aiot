import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ControlView from "@/components/ControlView";

export const dynamic = "force-dynamic";

// Phase 9에서 홈(/)으로 흡수 예정 — 그때까지 기존 관제뷰 유지
export default function ControlPage() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant");
  return (
    <AppShell user={user}>
      <ControlView />
    </AppShell>
  );
}
