import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/lib/theme.css";
import "./globals.css";
import "./home.css";

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
  title: "Eduino AI · Mission Deck",
  description: "AI 에이전트와 함께하는 팀 업무 관리 (AIoT 교육플랫폼 사업팀)",
  icons: {
    icon: [{ url: "/brand/favicon-48.png", type: "image/png", sizes: "48x48" }],
    apple: [{ url: "/brand/apple-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
