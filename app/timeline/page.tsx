import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Nav from "@/components/Nav";
import TimelineView from "@/components/TimelineView";

export const dynamic = "force-dynamic";

export default function TimelinePage() {
  const user = getSession();
  if (!user) redirect("/login");
  return (
    <div className="shell">
      <Nav user={user} />
      <TimelineView />
    </div>
  );
}
