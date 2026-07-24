import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import AppShell from "@/components/AppShell";
import ProfileView from "@/components/ProfileView";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = getSession();
  if (!user) redirect("/login");
  const row = await queryOne<{ short_name: string | null }>(
    "SELECT short_name FROM actor WHERE id = $1",
    [user.id]
  );
  return (
    <AppShell user={user}>
      <ProfileView user={user} initialShortName={row?.short_name ?? ""} />
    </AppShell>
  );
}
