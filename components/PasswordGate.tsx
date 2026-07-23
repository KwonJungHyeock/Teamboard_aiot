"use client";

// 최초 로그인 비밀번호 변경 게이트 (Phase 8) — must_change_pw=true인 동안
// AppShell이 본문 대신 이 화면만 렌더한다. 변경 완료 시 새로고침으로 정상 진입.
import { useState } from "react";

export default function PasswordGate({ name }: { name: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (next !== confirm) {
      setError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "변경 실패");
      return;
    }
    window.location.href = "/"; // 게이트 해제 후 홈으로
  }

  return (
    <div className="pwgate">
      <div className="pwgate-card">
        <div className="eb">SECURITY</div>
        <h1>비밀번호를 변경하세요</h1>
        <p>{name}님, 최초 로그인입니다. 임시 비밀번호를 새 비밀번호로 바꿔야 계속할 수 있습니다.</p>
        <label>임시(현재) 비밀번호</label>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label>새 비밀번호 (8자 이상)</label>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label>새 비밀번호 확인</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && <p className="gerr">{error}</p>}
        <button className="gbtn" disabled={busy || !current || !next} onClick={submit}>
          변경하고 계속
        </button>
      </div>
    </div>
  );
}
