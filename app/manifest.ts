// 앱 설치(PWA) — 브라우저 주소창의 「설치」로 독 · 작업 표시줄에 아이콘이 생긴다 (2026-10 알림 A).
import type { MetadataRoute } from "next";
import { TEAM_NAME } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${TEAM_NAME} 통합업무관리`,
    short_name: "팀보드",
    description: "관제 · 내 업무 · 내 기록 · 회의실",
    start_url: "/v3/calendar",
    scope: "/",
    display: "standalone",
    background_color: "#F4F7FB",
    theme_color: "#121A2B",
    lang: "ko",
    icons: [
      // 2026-10 — 받은 로고 원본(ed-mark)을 벡터로 따서 다시 뽑았다. ?v= 는 설치된 앱 · 탭이 옛 아이콘을 붙들지 않게
      { src: "/brand/app-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app-maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
