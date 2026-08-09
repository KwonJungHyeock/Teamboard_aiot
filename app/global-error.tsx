"use client";

// 루트 레이아웃 자체가 터진 경우의 최후 방어 (MD-P-2026-015 §D).
// 이 컴포넌트는 <html>·<body>를 직접 그려야 하고, 레이아웃의 CSS를 못 받으므로
// 최소한의 인라인 스타일만 쓴다. 토큰 파일이 안 실렸을 수도 있어 값을 직접 적는다.
// 숫자는 §A1 6단 스케일의 값을 그대로 옮긴 것이다 — var() 를 못 쓸 뿐 스케일 밖은 아니다.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#F7F8F9", color: "#16191D", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 460, textAlign: "center" }}>
            <p style={{ fontSize: 13.5, letterSpacing: ".08em", color: "#8A929C", margin: "0 0 10px" }}>MISSION DECK</p>
            <h1 style={{ fontSize: 20, margin: "0 0 10px" }}>앱을 불러오지 못했어요</h1>
            <p style={{ fontSize: 15, lineHeight: 1.6, color: "#525A66", margin: "0 0 18px" }}>
              새로고침해도 같은 화면이 나오면 팀장에게 알려주세요.
              {error.digest ? ` (오류 번호 ${error.digest})` : ""}
            </p>
            <button
              onClick={reset}
              style={{ height: 40, padding: "0 20px", border: 0, borderRadius: 6, background: "#C7383C", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            >
              다시 시도
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
