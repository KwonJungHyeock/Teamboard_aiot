"use client";

// 구성원 관리(관리자) — 역할 · 관리자 권한 · 활성. 지우는 자리는 없다(활성만 끈다).
// 규칙은 lib/v3/members.ts(서버와 같은 기준), API 는 /api/members 그대로.
import { useCallback, useEffect, useState } from "react";
import { initial } from "@/lib/ed/core";
import {
  whyCannotLower, whyCannotDeactivate, grantFixedWhy, roleBlocked, grantOffBlocked, ROLE_LABEL, ROLE_CHOICES, type MemberRow,
} from "@/lib/v3/members";

export default function Members({ me }: { me: number }) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const load = useCallback(async () => {
    const r = await fetch("/api/members").catch(() => null);
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
  return (
    <div className="ed-page">
      <div className="ed-head"><h1 className="ed-h1">구성원 관리</h1></div>
      {err && <div className="ed-err">{err}</div>}
      <section className="ed-sec q" style={{ gap: 0, padding: "8px 22px" }}>
        {rows === null ? <div className="ed-empty">불러오는 중</div> : list.length === 0 ? <div className="ed-empty">비어 있음</div> : list.map((m) => {
          const why = note[m.id] || whyCannotLower(list, m) || whyCannotDeactivate(list, m, me);
          const offWhy = whyCannotDeactivate(list, m, me);
          const fixed = grantFixedWhy(m);
          return (
            <div key={m.id} className="mem-row" style={{ opacity: m.isActive ? 1 : 0.5 }}>
              <span className="ed-av">{initial(m.name)}</span>
              <div className="mem-who"><b>{m.name}</b><small>{m.email || "—"}</small></div>
              <select className="ed-input mem-sel" aria-label={`${m.name} 역할`} value={m.role} disabled={busy === m.id} onChange={(e) => void send(m.id, { role: e.target.value })}>
                {ROLE_CHOICES.map((r) => <option key={r} value={r} disabled={r !== m.role && roleBlocked(list, m, r)}>{ROLE_LABEL[r]}</option>)}
              </select>
              {fixed ? <span className="ed-badge" title={fixed}>권한 고정</span> : (
                <button type="button" className={`ed-chip${m.adminGrant ? " on" : ""}`} disabled={busy === m.id || grantOffBlocked(list, m)}
                        aria-pressed={m.adminGrant} onClick={() => void send(m.id, { adminGrant: !m.adminGrant })}>관리자 권한{m.adminGrant ? " ✓" : ""}</button>
              )}
              <button type="button" className={`ed-btn sm${m.isActive ? "" : " flt"}`} disabled={busy === m.id || (m.isActive && offWhy !== null)}
                      title={m.isActive ? offWhy ?? undefined : undefined} onClick={() => void send(m.id, { isActive: !m.isActive })}>{m.isActive ? "활성" : "비활성"}</button>
              {why && <div className="mem-why">{why}</div>}
            </div>
          );
        })}
      </section>
    </div>
  );
}
