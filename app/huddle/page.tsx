import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import HuddleFeed from "@/components/HuddleFeed";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <HuddleFeed user={user} />
    </AppShell>
  );
}
