"use client";

// v3 「내 정보」 (MD-P-2026-067 §D · 필수 9).
//
// ── 가장 작게 만든다 ────────────────────────────────────────────
//
// 「로그인한 사람이 자기 정보를 못 보면 이상하다」는 것이 이 화면이 필수인
// 이유의 전부다(§D). 그래서 **보여 줄 것 넷, 할 수 있는 것 하나**뿐이다.
//
//   보여 줄 것 — 이름 · 이메일 · 역할 · 소속 팀. **읽기만.**
//   할 수 있는 것 — **비밀번호 바꾸기 하나.** 그 밖은 넣지 않는다.
//
// ── 무엇을 먹는가 ──────────────────────────────────────────────
//
// `POST /api/account/password` 하나뿐이다. 보여 주는 넷은 **서버가 넘겨 준다** —
// 화면이 또 불러오면 셸의 이름표와 이 화면이 다른 것을 말할 수 있다.
import { useState } from "react";
import { Card, Button } from "./parts";

export default function MeView({
  name, email, roleLabel, team,
}: { name: string; email: string; roleLabel: string; team: string }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true); setMsg(""); setOk(false);
    const r = await fetch("/api/account/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: cur, newPassword: next }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      // **서버가 준 이유를 그대로 낸다.** 삼키면 사람은 같은 것을 반복한다.
      setMsg(d.error ?? `바꾸지 못했습니다 (${r.status})`);
      return;
    }
    setCur(""); setNext("");
    setOk(true);
    setMsg("비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 씁니다.");
  };

  return (
    <>
      <h1 className="v3-h1">내 정보</h1>
      <p className="v3-lede">이름과 이메일은 관리자가 고칩니다. 여기서는 비밀번호만 바꿉니다.</p>

      {/* 넷 — **읽기만.** 못 고치는 칸을 고칠 수 있는 모양으로 그리지 않는다 */}
      <Card title="계정">
        <div className="v3-prop" data-k="이름">
          <span className="v3-prop-k">이름</span>
          <span className="v3-prop-v ro">{name}</span>
        </div>
        <div className="v3-prop" data-k="이메일">
          <span className="v3-prop-k">이메일</span>
          {/* 비어 있으면 **비어 있다고 적는다** — 합칠 때 사람을 맞추는 열쇠다(§E-31) */}
          <span className="v3-prop-v ro">{email || <span className="empty">없음</span>}</span>
        </div>
        <div className="v3-prop" data-k="역할">
          <span className="v3-prop-k">역할</span>
          <span className="v3-prop-v ro">{roleLabel}</span>
        </div>
        <div className="v3-prop" data-k="소속 팀">
          <span className="v3-prop-k">소속 팀</span>
          <span className="v3-prop-v ro">{team}</span>
        </div>
        <p className="v3-why">
          지금은 팀이 하나뿐이라 모든 줄이 같은 팀입니다. 줄마다 팀을 적는 칸은
          아직 안 들어갔습니다.
        </p>
      </Card>

      {/* 할 수 있는 것 **하나** */}
      <Card title="비밀번호 바꾸기">
        <div className="v3-newrow">
          <label htmlFor="v3-pw-cur">지금 비밀번호</label>
          <input id="v3-pw-cur" type="password" autoComplete="current-password"
                 value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <div className="v3-newrow">
          <label htmlFor="v3-pw-new">새 비밀번호</label>
          <input id="v3-pw-new" type="password" autoComplete="new-password"
                 value={next} onChange={(e) => setNext(e.target.value)} />
          <span className="v3-newwhy">8자 이상</span>
        </div>
        <div className="v3-newfoot">
          <Button primary disabled={busy || cur === "" || next.length < 8}
                  onClick={() => void save()}>
            {busy ? "바꾸는 중…" : "바꾸기"}
          </Button>
          {/* 못 누르는 이유를 **버튼 옆에** 적는다 */}
          {!busy && (cur === "" || next.length < 8) && (
            <span className="v3-newwhy">
              {cur === "" ? "지금 비밀번호를 적어 주세요" : "새 비밀번호는 8자 이상이어야 합니다"}
            </span>
          )}
        </div>
        {msg && <p className={ok ? "v3-why" : "v3-err v3-newerr"} role="status">{msg}</p>}
      </Card>
    </>
  );
}
