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
      router.push("/assistant");
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>
          팀보드<span style={{ color: "var(--accent)" }}>.</span>
        </h1>
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
