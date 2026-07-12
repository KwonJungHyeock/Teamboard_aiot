import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Nav from "@/components/Nav";
import NotionScopeSettings from "@/components/NotionScopeSettings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const user = getSession();
  if (!user) redirect("/login");
  if (user.role !== "lead") redirect("/assistant"); // 연동 범위 수정은 팀장만 (PRD 11장)
  return (
    <div className="shell">
      <Nav user={user} />
      <NotionScopeSettings />
    </div>
  );
}
