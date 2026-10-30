// 옛 「대시보드」 — 첫 화면은 홈(일정 + 내 업무 요약)이다 (2026-10 팀 피드백 2차).
import { redirect } from "next/navigation";
export default function V3Root() { redirect("/v3/calendar"); }
