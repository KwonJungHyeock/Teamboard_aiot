// 앱 설치(PWA) — 브라우저 주소창의 「설치」로 독 · 작업 표시줄에 아이콘이 생긴다 (2026-10 알림 A).
import type { MetadataRoute } from "next";
import { TEAM_NAME } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${TEAM_NAME} 통합업무관리`,
    short_name: "팀보드",
    description: "관제 · 내 업무 · 내 기록 · 회의실",
    start_url: "/v3/control",
    scope: "/",
    display: "standalone",
    background_color: "#F4F7FB",
    theme_color: "#121A2B",
    lang: "ko",
    icons: [
      { src: "/brand/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
