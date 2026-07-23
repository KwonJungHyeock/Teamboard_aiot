import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import PlaceholderPage from "@/components/PlaceholderPage";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant");
  return (
    <AppShell user={user}>
      <PlaceholderPage title="구성원" phase="Phase 8" />
    </AppShell>
  );
}
