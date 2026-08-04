import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ProjectWorkspace from "@/components/ProjectWorkspace";

export const dynamic = "force-dynamic";

export default function Page({ params }: { params: { id: string } }) {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <ProjectWorkspace user={user} projectId={Number(params.id)} />
    </AppShell>
  );
}
