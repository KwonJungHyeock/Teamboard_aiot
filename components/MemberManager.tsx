"use client";

// 구성원 관리 (Phase 8) — lead 전용. 목록 + 계정 발급(임시 비밀번호 표시) + 역할/활성 제어.
import { useCallback, useEffect, useState } from "react";
import PageShell from "./PageShell";
import type { SessionUser } from "@/lib/types";
import Skeleton from "./Skeleton";
import ErrorNote from "./ErrorNote";

interface Member {
  id: number;
  displayName: string;
  shortName: string | null;
  email: string;
  role: string;
  mustChangePw: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  assistantName: string | null;
}

const ROLE_LABEL: Record<string, string> = { lead: "팀장", member: "팀원", viewer: "뷰어" };
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear().toString().slice(2)}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function NewMemberForm({ onCreated }: { onCreated: (tempPw: string, email: string) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [shortName, setShortName] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!displayName.trim() || !email.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, email, shortName, role }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "발급 실패");
      return;
    }
    setDisplayName("");
    setEmail("");
    setShortName("");
    onCreated(data.tempPassword, email);
  }

  return (
    <section className="card">
      <div className="ch">
        <h2>새 계정 발급</h2>
        <span className="sub">임시 비밀번호가 발급되고, 최초 로그인 시 변경이 강제됩니다</span>
      </div>
      <div className="tform-grid">
        <div className="tform-r">
          <label>이름</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="예: 김하늘" />
        </div>
        <div className="tform-r">
          <label>표시 이름(호칭)</label>
          <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="미입력 시 이름 전체" />
        </div>
        <div className="tform-r">
          <label>이메일</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@robodyne.co.kr" />
        </div>
        <div className="tform-r">
          <label>역할</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">팀원</option>
            <option value="lead">팀장</option>
            <option value="viewer">뷰어</option>
          </select>
        </div>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="tform-a">
        <button className="gbtn" disabled={busy || !displayName.trim() || !email.trim()} onClick={submit}>
          계정 발급 · 에이전트 생성
        </button>
      </div>
    </section>
  );
}

export default function MemberManager({ user }: { user: SessionUser }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ email: string; tempPw: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/members");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "구성원 조회 실패");
      setMembers(data.members ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    const res = await fetch(`/api/members/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "변경 실패");
      return;
    }
    setError("");
    load();
  }

  return (
    <PageShell
      crumb={["관리", "구성원"]}
      title="구성원"
      subtitle={<>계정 발급 시 에이전트가 자동 생성되고 캘린더 레인이 늘어납니다. 삭제 대신 비활성화만 가능합니다.</>}
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        {issued && (
          <section className="card mbr-issued">
            <b>임시 비밀번호가 발급되었습니다 — 이 값은 다시 표시되지 않습니다.</b>
            <div className="mbr-pw">
              <span>{issued.email}</span>
              <code>{issued.tempPw}</code>
            </div>
            <button className="lk mu" onClick={() => setIssued(null)}>
              확인
            </button>
          </section>
        )}

        {error && <ErrorNote message={error} onRetry={load} />}

        <section className="card">
          <div className="ch">
            <h2>구성원 목록</h2>
            <span className="sub">{members.length}명</span>
          </div>
          {loading && <Skeleton variant="list" />}
          <table>
            <colgroup>
              <col style={{ width: "17%" }} />
              <col style={{ width: "21%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>에이전트</th>
                <th>역할</th>
                <th>가입</th>
                <th>최근 접속</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} style={{ opacity: m.isActive ? 1 : 0.5 }}>
                  {/* H-1 — 이 칸은 **사람 이름 하나만** 쓴다.
                      전에는 이름 · 짧은이름 · "에이전트 " + 에이전트이름을 이어 붙여
                      "권정혁 · 정혁 에이전트 정혁의 에이전트"가 됐다. 세 값이 다 같은
                      사람 이름에서 파생된 것이라, 이어 붙이는 순간 같은 말이 세 번 나온다.
                      짧은 이름은 다른 화면(멘션·아바타)에서 쓰고 여기엔 안 쓴다.
                      에이전트는 자기 열에서 본다. 비번변경 대기는 이름이 아니라 처리해야 할
                      상태라 남긴다 — 여기서 빼면 볼 데가 없다. */}
                  <td>
                    <span className="mbr-name">
                      <span className={`led ${m.isActive ? "s-done" : "s-drop"}`} title={m.isActive ? "활성" : "비활성"} aria-hidden="true" />
                      <span className="mbr-nm">
                        {m.displayName}
                        {m.mustChangePw && <small className="mbr-sub">비번변경 대기</small>}
                      </span>
                    </span>
                  </td>
                  <td>{m.email}</td>
                  <td className="mbr-agent">{m.assistantName ?? "—"}</td>
                  <td>
                    <select
                      className={`role-sel role-${m.role}`}
                      value={m.role}
                      disabled={!m.isActive}
                      onChange={(e) => patch(m.id, { role: e.target.value })}
                      aria-label={`역할 (${ROLE_LABEL[m.role] ?? m.role})`}
                    >
                      <option value="member">팀원</option>
                      <option value="lead">팀장</option>
                      <option value="viewer">뷰어</option>
                    </select>
                  </td>
                  <td className="num mbr-date">{shortDate(m.createdAt)}</td>
                  <td className="num mbr-date">{shortDate(m.lastLoginAt)}</td>
                  <td>
                    {m.isActive ? (
                      <button
                        className="lk mu"
                        disabled={m.id === user.id}
                        title={m.id === user.id ? "본인은 비활성화할 수 없습니다" : ""}
                        onClick={() => patch(m.id, { isActive: false })}
                      >
                        비활성화
                      </button>
                    ) : (
                      <button className="lk" onClick={() => patch(m.id, { isActive: true })}>
                        재활성화
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <NewMemberForm onCreated={(tempPw, email) => { setIssued({ tempPw, email }); load(); }} />
      </div>
    </div>
    </PageShell>
  );
}
