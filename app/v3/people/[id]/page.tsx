// 팀원 상세 · 개인 성과 카드 (2026-11) — 팀장은 누구든, 팀원은 자기 것만(남의 것을 열면 내 카드로). `me` 는 나.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { hasLead } from "@/lib/types";
import Person from "@/components/ed/screens/Person";
import "../../../ed-person.css";

export const dynamic = "force-dynamic";

export default async function V3Person({ params }: { params: { id: string } }) {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const lead = hasLead(live.user.role) || live.user.adminGrant;
  const id = params.id === "me" ? live.user.id : Number(params.id);
  if (!Number.isInteger(id) || id <= 0 || (!lead && id !== live.user.id)) redirect(`/v3/people/${live.user.id}`);
  return <Person key={id} personId={id} meId={live.user.id} />;
}
