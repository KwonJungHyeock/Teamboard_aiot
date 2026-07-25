import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import InboxView from "@/components/InboxView";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <InboxView user={user} />
    </AppShell>
  );
}
