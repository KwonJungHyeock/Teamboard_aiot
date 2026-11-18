// 업무 요청 (2026-11-18) — 팀원끼리 일을 부탁하고, 받은 사람이 수락하면 업무가 된다. 누구나 연다.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import Requests from "@/components/ed/screens/Requests";
import "../../ed-request.css";

export const dynamic = "force-dynamic";

export default async function V3Requests() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  return <Requests />;
}
