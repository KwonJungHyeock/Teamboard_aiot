import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AssistantView from "@/components/AssistantView";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <AssistantView user={user} />
    </AppShell>
  );
}
