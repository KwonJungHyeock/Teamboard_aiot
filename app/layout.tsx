import type { Metadata } from "next";
import localFont from "next/font/local";
import "./ed.css";   // 디자인 v1.0 — 토큰 · 공통 프레임 · 공통 부품 (2026-10 리디자인)
import { APP_NAME, ORG_NAME, TEAM_NAME } from "@/lib/brand";

// Pretendard Variable — self-host woff2 (CDN 런타임 의존 제거, 오프라인·CLS 0).
// next/font/local 이 @font-face + preload 자동 생성. 폰트 점프 없음.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920", // variable weight 범위
  variable: "--font-pretendard",
  preload: true,
  fallback: ["-apple-system", "system-ui", "sans-serif"],
});

// JetBrains Mono — 로고 "MISSION DECK" · 시계 · 코드성 토큰 전용 모노 (self-host)
const jetbrainsMono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/JetBrainsMono-600.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-jetbrains",
  preload: true,
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: `${APP_NAME} · ${ORG_NAME}`,
  description: `팀 업무 관리 (${TEAM_NAME})`,
  icons: {
    icon: [{ url: "/brand/favicon-48.png", type: "image/png", sizes: "48x48" }],
    apple: [{ url: "/brand/apple-icon.png", sizes: "180x180" }],
  },
};

const THEME_BOOT = `try{var t=localStorage.getItem("eduino-theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        {/* 테마는 칠하기 전에 정한다 — 다크로 고른 사람이 흰 화면을 한 번 보지 않게 (localStorage['eduino-theme']) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
