import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Nav from "@/components/Nav";
import ControlView from "@/components/ControlView";

export const dynamic = "force-dynamic";

export default function ControlPage() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant");
  return (
    <div className="shell">
      <Nav user={user} />
      <ControlView />
    </div>
  );
}
