import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ReportsView from "@/components/ReportsView";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant");
  return (
    <AppShell user={user}>
      <ReportsView />
    </AppShell>
  );
}
