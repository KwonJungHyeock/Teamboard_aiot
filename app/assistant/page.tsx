import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Nav from "@/components/Nav";
import AssistantView from "@/components/AssistantView";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <div className="shell">
      <Nav user={user} />
      <AssistantView user={user} />
    </div>
  );
}
