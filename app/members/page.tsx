import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import MemberManager from "@/components/MemberManager";

export const dynamic = "force-dynamic";

export default function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant");
  return (
    <AppShell user={user}>
      <MemberManager user={user} />
    </AppShell>
  );
}
