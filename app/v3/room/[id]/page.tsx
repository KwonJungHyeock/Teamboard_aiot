// 회의 하나 — 영상 스테이지 + 패널 (디자인 v1.0 · meeting.dc.html)
import { notFound, redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { getActiveHumans } from "@/lib/db";
import { hasLead } from "@/lib/types";
import { getMeeting, heartbeat, jitsiDomain } from "@/lib/meeting";
import Room, { type MeetingData } from "@/components/ed/screens/Room";
import "../../../ed-room.css";

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
    <Room initial={meeting as unknown as MeetingData} me={{ id: live.user.id, name: live.user.name }}
          lead={hasLead(live.user.role) || live.user.adminGrant} domain={jitsiDomain()} people={people} />
  );
}
