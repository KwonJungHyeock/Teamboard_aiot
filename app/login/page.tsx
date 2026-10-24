"use client";

// 로그인 — 디자인 v1.0 (login.dc.html · DESIGN.md 5.1). 가운데 400px 열 + 공통 배경 + 오른쪽 위 테마.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Backdrop, ThemePill } from "@/components/ed/Frame";
import { TEAM_NAME } from "@/lib/brand";
import "../ed-login.css";

const REASON: Record<string, string> = { inactive: "비활성화된 계정입니다" };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [bad, setBad] = useState<"email" | "pw" | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("reason");
    if (r && REASON[r]) setError(REASON[r]);
  }, []);

  const fail = (msg: string, which: "email" | "pw" | null) => { setError(msg); setBad(which); setShake((n) => n + 1); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) return fail("업무메일을 입력하세요", "email");
    if (!pw) return fail("비밀번호를 입력하세요", "pw");
    setBusy(true); setError(""); setBad(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { fail(data.error ?? "로그인하지 못했습니다", "pw"); return; }
      router.push("/");
      router.refresh();
    } catch {
      fail("서버에 연결할 수 없습니다", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lg-wrap">
      <Backdrop />
      <div className="lg-theme"><ThemePill /></div>
      <div className="lg-col">
        <div className="lg-brand">
          <div className="lg-mark">
            <i className="glow" aria-hidden="true" />
            <div className="tile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lt" src="/brand/ed-mark.png" alt="Eduino AI" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="dk" src="/brand/ed-mark-dark.png" alt="" />
            </div>
          </div>
          <div className="nm"><b>Eduino AI</b><span>통합업무관리</span></div>
        </div>
        <form className="lg-card" key={shake} data-shake={shake ? (shake % 2 ? "A" : "B") : undefined} onSubmit={submit} noValidate>
          <label>
            <span>업무메일</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@robodyne.co.kr"
                   autoComplete="username" className={bad === "email" ? "bad" : undefined} />
          </label>
          <label>
            <span>비밀번호</span>
            <div className="pw">
              <input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password"
                     className={bad === "pw" ? "bad" : undefined} />
              <button type="button" onClick={() => setShow((s) => !s)}>{show ? "숨기기" : "보기"}</button>
            </div>
          </label>
          {error && <div className="err" role="alert">{error}</div>}
          <button type="submit" className="go" style={{ opacity: busy ? 0.85 : 1 }}>
            {busy && <i className="spin" aria-hidden="true" />}{busy ? "로그인 중" : "로그인"}
          </button>
        </form>
        <div className="team">{TEAM_NAME}</div>
      </div>
    </div>
  );
}
