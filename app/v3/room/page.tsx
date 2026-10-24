// 회의 — 목록 · 새 회의 · 결정 찾기 (디자인 v1.0)
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { findDecisions, listMeetings } from "@/lib/meeting";
import RoomList from "@/components/ed/screens/RoomList";
import "../../ed-room.css";

export const dynamic = "force-dynamic";

export default async function V3Room() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  const [meetings, decisions] = await Promise.all([listMeetings(), findDecisions("", 30)]);
  return <RoomList initial={meetings} decisions={decisions} />;
}
