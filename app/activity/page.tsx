// 활동 (MD-P-2026-006 §G) — 이전 "알림". 라벨·경로만 정렬하고 내용은 그대로다.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ActivityInbox from "@/components/ActivityInbox";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <ActivityInbox />
    </AppShell>
  );
}
