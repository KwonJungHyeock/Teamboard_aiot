// 회의 하나 — 영상(Jitsi) · 안건 · 링크 · 결정 · 할 일. 끝나면 회의록 (0038).
import { notFound, redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { getActiveHumans } from "@/lib/db";
import { hasLead } from "@/lib/types";
import { getMeeting, heartbeat, jitsiDomain } from "@/lib/meeting";
import RoomView from "@/components/v3/RoomView";
import "../../../v3-room.css";

export const dynamic = "force-dynamic";

export default async function V3RoomOne({ params }: { params: { id: string } }) {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  await heartbeat(id, live.user.id);
  const meeting = await getMeeting(id);
  if (!meeting) notFound();
  const people = (await getActiveHumans()).map((a) => ({ id: a.id, name: a.display_name }));
  return (
    <RoomView initial={meeting} me={{ id: live.user.id, name: live.user.name }}
              lead={hasLead(live.user.role)} domain={jitsiDomain()} people={people} />
  );
}
