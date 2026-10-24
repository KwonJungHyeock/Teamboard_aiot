// 설정 — 팀장 · 관리자 (2026-10 · 옛 「설정」을 지우며 생긴 빈자리를 메운다).
// 값은 전부 기존 API 가 쓴다: /api/settings/platform · /api/settings/notion-scope · /api/notion/resource.
import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth";
import { hasLead } from "@/lib/types";
import { deniedHref } from "@/lib/denied";
import SettingsView from "@/components/v3/SettingsView";
import "../../v3-connect.css";

export const dynamic = "force-dynamic";

export default async function V3Settings() {
  const live = await getLiveSession();
  if (!live) redirect("/api/auth/logout?reason=inactive");
  if (!hasLead(live.user.role)) redirect(deniedHref("settings"));
  return <SettingsView />;
}
