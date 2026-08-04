// 저장됨 (MD-P-2026-006 §G) — hover 액션 바에서 저장한 항목이 모이는 곳.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import SavedView from "@/components/SavedView";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <SavedView />
    </AppShell>
  );
}
