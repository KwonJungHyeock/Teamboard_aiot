import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import PlaceholderPage from "@/components/PlaceholderPage";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <PlaceholderPage title="전체 프로젝트" phase="Phase 5" />
    </AppShell>
  );
}
