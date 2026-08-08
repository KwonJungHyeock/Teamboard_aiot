"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const REASON_MESSAGE: Record<string, string> = {
  inactive: "계정이 비활성화되었습니다. 관리자에게 문의하세요.",
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // 서버측 세션 무효화(?reason=inactive 등) 사유 표시 — window에서 직접 읽어 Suspense 불필요
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason && REASON_MESSAGE[reason]) setNotice(REASON_MESSAGE[reason]);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "로그인 실패");
        return;
      }
      // 로그인 후 첫 화면은 **홈**이다 (MD-P-2026-026 지시 30).
      // 예전에는 /assistant 로 보냈다 — 새 팀원이 처음 보는 화면이 에이전트 콘솔이고
      // "잔여 토큰 2,000,000" 이 먼저 보였다. 이 제품이 무엇인지 잘못 말하는 첫인상이다.
      //
      // 들어오려던 경로로 되돌리는 동작은 **없다.** middleware 가 /login 으로 보낼 때
      // 원래 경로를 남기지 않는다(?next= 없음). 이번에는 만들지 않는다.
      router.push("/");
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      {/* Eduino AI 로고 — 다크 앵커 배경(사이드바 그라데이션)에 ondark 마크 + 라이트 텍스트 */}
      <div className="login-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-mk-img" src="/brand/eduino_mark_ondark.png" alt="Eduino AI" width={72} height={49} />
        <div className="login-hero-t">
          <b>Eduino AI</b>
          <span>MISSION DECK</span>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <p className="sub">AIoT 교육플랫폼 사업팀 · 회사 업무메일로 로그인</p>
        {notice && (
          <p
            className="error-text"
            role="alert"
            style={{ background: "rgba(245,165,36,.12)", border: "1px solid rgba(245,165,36,.3)", color: "#F5A524", padding: "8px 11px", borderRadius: 8 }}
          >
            {notice}
          </p>
        )}
        <div className="field">
          <label>업무메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@robodyne.co.kr"
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label>비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "확인 중..." : "로그인"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
