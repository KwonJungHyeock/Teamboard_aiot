import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import AppShell from "@/components/AppShell";
import AreaView from "@/components/AreaView";

export const dynamic = "force-dynamic";

export default async function AreaPage({ params }: { params: { key: string } }) {
  const user = getSession();
  if (!user) redirect("/login");

  // is_active=false 또는 미존재 → 404 (서버에서 확정)
  const id = Number(params.key);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const area = await queryOne<{ id: number }>(
    `SELECT id FROM area WHERE id = $1 AND is_active = true`,
    [id]
  );
  if (!area) notFound();

  return (
    <AppShell user={user}>
      <AreaView areaKey={params.key} />
    </AppShell>
  );
}
