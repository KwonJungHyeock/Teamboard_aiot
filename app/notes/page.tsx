import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import NotesView from "@/components/NotesView";

export const dynamic = "force-dynamic";

export default function NotesPage() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <NotesView />
    </AppShell>
  );
}
