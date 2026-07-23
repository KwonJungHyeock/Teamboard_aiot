// DEPRECATED — Phase 9에서 홈으로 흡수 후 삭제
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ControlView from "@/components/ControlView";

export const dynamic = "force-dynamic";

export default function ControlPage() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant");
  return (
    <AppShell user={user}>
      <p className="muted" style={{ marginBottom: 14 }}>
        ⓘ 이 화면은 홈 대시보드로 통합될 예정입니다.
      </p>
      <ControlView />
    </AppShell>
  );
}
