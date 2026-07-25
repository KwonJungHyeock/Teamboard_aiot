import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import HandoverView from "@/components/HandoverView";

export const dynamic = "force-dynamic";

export default function HandoverPage() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <HandoverView user={user} />
    </AppShell>
  );
}
