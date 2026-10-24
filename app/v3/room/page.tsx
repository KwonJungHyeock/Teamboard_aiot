// 회의실 — 열린 회의 · 지난 회의 · 새 회의 (2026-10 회의실 · 0038).
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { listMeetings } from "@/lib/meeting";
import RoomListView from "@/components/v3/RoomListView";
import "../../v3-room.css";

export const dynamic = "force-dynamic";

export default async function V3Room() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <RoomListView initial={await listMeetings()} />;
}
