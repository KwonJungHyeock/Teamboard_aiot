"use client";

// 구성원 관리(관리자) — 추가 · 역할 · 관리자 권한 · 삭제.
// 「삭제」는 계정을 끈다(비활성) — 그 사람이 남긴 업무 · 기록은 그대로 남고, 「지운 구성원」에서 되살린다.
// 추가하면 임시 비밀번호가 **한 번만** 나온다. 그 사람은 처음 로그인하면 비밀번호부터 바꾼다.
// 규칙은 lib/v3/members.ts(서버와 같은 기준), API 는 /api/members 그대로.
import { useCallback, useEffect, useState } from "react";
import { initial, isEnter } from "@/lib/ed/core";
import {
  whyCannotLower, whyCannotDeactivate, grantFixedWhy, roleBlocked, grantOffBlocked, ROLE_LABEL, ROLE_CHOICES, type MemberRow,
} from "@/lib/v3/members";

function AddMember({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<{ name: string; email: string; pw: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const ok = name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const add = async () => {
    if (!ok || busy) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim(), email: email.trim(), role }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) { setErr(d.error ?? "추가하지 못했습니다"); return; }
    setMade({ name: name.trim(), email: email.trim().toLowerCase(), pw: d.tempPassword });
    setName(""); setEmail(""); setRole("member");
    await onDone();
  };
  const msg = made ? `[통합업무관리] ${made.name}님 계정\n주소: ${window.location.origin}\n아이디: ${made.email}\n임시 비밀번호: ${made.pw}\n처음 로그인하면 비밀번호를 바꿔 주세요.` : "";
  return (
    <section className="ed-sec q" style={{ gap: 12 }}>
      <h2>구성원 추가</h2>
      {made ? (
        <div className="mem-made">
          <div><b>{made.name}</b> 계정을 만들었습니다. 아래 임시 비밀번호는 <b>지금 한 번만</b> 보입니다.</div>
          <div>아이디 <code>{made.email}</code> · 임시 비밀번호 <code>{made.pw}</code></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="ed-btn sm" onClick={async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); } catch { /* 직접 옮겨 적는다 */ } }}>{copied ? "복사됨 ✓" : "안내 문구 복사"}</button>
            <button type="button" className="ed-btn sm pri" onClick={() => { setMade(null); setCopied(false); }}>완료</button>
          </div>
        </div>
      ) : (
        <div className="mem-add">
          <input className="ed-input" placeholder="이름" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="이름" />
          <input className="ed-input" placeholder="아이디(이메일)" value={email} type="email" onChange={(e) => setEmail(e.target.value)} aria-label="아이디(이메일)"
                 onKeyDown={(e) => { if (isEnter(e)) void add(); }} />
          <select className="ed-input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="역할">
            {ROLE_CHOICES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button type="button" className="ed-btn pri" disabled={!ok || busy} onClick={() => void add()}>{busy ? "추가 중" : "추가"}</button>
        </div>
      )}
      {err && <div className="ed-err" role="status">{err}</div>}
    </section>
  );
}

export default function Members({ me }: { me: number }) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    const r = await fetch("/api/members", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) { setErr("불러오지 못했습니다"); return; }
    const d = await r.json().catch(() => ({}));
    setRows((d.members ?? []).map((m: { id: number; displayName: string; email: string | null; role: string; adminGrant: boolean; isActive: boolean }) =>
      ({ id: m.id, name: m.displayName, email: m.email, role: m.role, adminGrant: m.adminGrant === true, isActive: m.isActive !== false })));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const send = async (id: number, patch: Record<string, unknown>) => {
    setBusy(id); setNote((n) => ({ ...n, [id]: "" }));
    const r = await fetch(`/api/members/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setNote((n) => ({ ...n, [id]: d.error ?? "바꾸지 못했습니다" })); return; }
    await load();
  };
  const list = rows ?? [];
  const live = list.filter((m) => m.isActive);
  const gone = list.filter((m) => !m.isActive);
  const remove = (m: MemberRow) => {
    if (!window.confirm(`${m.name}님을 구성원에서 지울까요?\n로그인할 수 없게 되고 담당자 목록에서 빠집니다.\n남긴 업무 · 기록은 그대로 남고, 아래 「지운 구성원」에서 되살릴 수 있습니다.`)) return;
    void send(m.id, { isActive: false });
  };
  return (
    <div className="ed-page">
      <div className="ed-head"><h1 className="ed-h1">구성원 관리</h1></div>
      {err && <div className="ed-err">{err}</div>}
      <AddMember onDone={load} />
      <section className="ed-sec q" style={{ gap: 0, padding: "8px 22px" }}>
        {rows === null ? <div className="ed-empty">불러오는 중</div> : live.length === 0 ? <div className="ed-empty">비어 있음</div> : live.map((m) => {
          // 줄 아래 글은 고칠 수 없는 이유 · 오류만 — 삭제를 못 하는 이유는 삭제 버튼에 대면 보인다
          const why = note[m.id] || whyCannotLower(list, m);
          const offWhy = whyCannotDeactivate(list, m, me);
          const fixed = grantFixedWhy(m);
          return (
            <div key={m.id} className="mem-row">
              <span className="ed-av">{initial(m.name)}</span>
              <div className="mem-who"><b>{m.name}</b><small>{m.email || "—"}</small></div>
              <select className="ed-input mem-sel" aria-label={`${m.name} 역할`} value={m.role} disabled={busy === m.id} onChange={(e) => void send(m.id, { role: e.target.value })}>
                {ROLE_CHOICES.map((r) => <option key={r} value={r} disabled={r !== m.role && roleBlocked(list, m, r)}>{ROLE_LABEL[r]}</option>)}
              </select>
              {fixed ? <span className="ed-badge" title={fixed}>권한 고정</span> : (
                <button type="button" className={`ed-chip${m.adminGrant ? " on" : ""}`} disabled={busy === m.id || grantOffBlocked(list, m)}
                        aria-pressed={m.adminGrant} onClick={() => void send(m.id, { adminGrant: !m.adminGrant })}>관리자 권한{m.adminGrant ? " ✓" : ""}</button>
              )}
              <button type="button" className="ed-btn sm gh red" disabled={busy === m.id || offWhy !== null}
                      title={offWhy ?? undefined} onClick={() => remove(m)}>삭제</button>
              {why && <div className="mem-why">{why}</div>}
            </div>
          );
        })}
      </section>
      {gone.length > 0 && (
        <section className="ed-sec q" style={{ gap: 0, padding: "12px 22px" }}>
          <h2 style={{ marginBottom: 6 }}>지운 구성원</h2>
          {gone.map((m) => (
            <div key={m.id} className="mem-off">
              <span className="ed-av">{initial(m.name)}</span>
              <div className="mem-who"><b>{m.name}</b><small>{m.email || "—"}</small></div>
              <button type="button" className="ed-btn sm" disabled={busy === m.id} onClick={() => void send(m.id, { isActive: true })}>되살리기</button>
              {note[m.id] && <span className="ed-err">{note[m.id]}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
