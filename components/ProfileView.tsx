"use client";

// 개별 프로필 (신규) — 본인 이름·닉네임·비밀번호만. 이메일·역할은 표시만(수정 불가, lead 전용).
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/types";

export default function ProfileView({
  user,
  initialShortName,
}: {
  user: SessionUser;
  initialShortName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [shortName, setShortName] = useState(initialShortName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");

  async function saveProfile() {
    if (!name.trim()) {
      setProfileErr("이름을 입력하세요.");
      return;
    }
    setSavingProfile(true);
    setProfileErr("");
    setProfileMsg("");
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), shortName: shortName.trim() }),
    });
    setSavingProfile(false);
    if (!res.ok) {
      setProfileErr((await res.json()).error ?? "저장 실패");
      return;
    }
    setProfileMsg("저장했습니다. 인사말·담당 표시에 바로 반영됩니다.");
    router.refresh(); // 사이드바·인사말 즉시 갱신
  }

  async function changePassword() {
    if (!currentPassword || !newPassword) {
      setPwErr("현재/새 비밀번호를 입력하세요.");
      return;
    }
    setSavingPw(true);
    setPwErr("");
    setPwMsg("");
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setSavingPw(false);
    if (!res.ok) {
      setPwErr((await res.json()).error ?? "변경 실패");
      return;
    }
    setPwMsg("비밀번호를 변경했습니다.");
    setCurrentPassword("");
    setNewPassword("");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>프로필</b>
        </div>
        <span className="sp" />
        <button className="btn-outline" onClick={logout}>
          로그아웃
        </button>
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">PROFILE</div>
            <h1>내 프로필</h1>
            <p>이름·닉네임·비밀번호를 직접 관리합니다. 이메일·역할 변경은 팀장에게 요청하세요.</p>
          </div>
        </div>

        <div className="cols">
          <div className="stack">
            {/* 이름·닉네임 */}
            <section className="card" aria-label="기본 정보">
              <div className="ch">
                <h2>기본 정보</h2>
              </div>
              <div className="tform">
                <div className="tform-r">
                  <label>이름 (display_name)</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="tform-r">
                  <label>닉네임 (short_name) — 인사말·캘린더 레인에 사용</label>
                  <input
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    placeholder="예: 정혁"
                  />
                </div>
                <div className="tform-r">
                  <label>이메일 (변경 불가 · 팀장 전용)</label>
                  <input value={user.email} disabled />
                </div>
                <div className="tform-r">
                  <label>역할 (변경 불가 · 팀장 전용)</label>
                  <input value={user.role === "lead" ? "LEAD" : user.role.toUpperCase()} disabled />
                </div>
                {profileErr && <p className="gerr">{profileErr}</p>}
                {profileMsg && <p className="rp-notice">{profileMsg}</p>}
                <div className="tform-a">
                  <button className="btn-brand" onClick={saveProfile} disabled={savingProfile || !name.trim()}>
                    저장
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="stack">
            {/* 비밀번호 변경 */}
            <section className="card" aria-label="비밀번호 변경">
              <div className="ch">
                <h2>비밀번호 변경</h2>
              </div>
              <div className="tform">
                <div className="tform-r">
                  <label>현재 비밀번호</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="tform-r">
                  <label>새 비밀번호 (8자 이상)</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                {pwErr && <p className="gerr">{pwErr}</p>}
                {pwMsg && <p className="rp-notice">{pwMsg}</p>}
                <div className="tform-a">
                  <button
                    className="btn-brand"
                    onClick={changePassword}
                    disabled={savingPw || !currentPassword || !newPassword}
                  >
                    비밀번호 변경
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
