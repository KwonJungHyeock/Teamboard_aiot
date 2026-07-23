import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { kstToday } from "@/lib/home";
import AppShell from "@/components/AppShell";
import GoalsView from "@/components/GoalsView";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <GoalsView user={user} initialYear={Number(kstToday().slice(0, 4))} />
    </AppShell>
  );
}
