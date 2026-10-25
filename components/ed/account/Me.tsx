"use client";

// 내 정보 — 계정 · 비밀번호 · 알림(이 기기) · Claude 연결. 계정 메뉴에서 연다.
// 기능은 옛 화면 그대로(/api/account/password · /api/push · /api/tokens), 설명 문장은 뺐다.
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
interface Kind { key: string; label: string }
interface Device { id: number; endpoint: string; kinds: string[]; userAgent: string | null; createdAt: string; lastOkAt: string | null }
interface TokenRow { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }

const seoul = (s: string | null, from = 5) => {
  const t = s ? Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z")) : NaN;
  return Number.isNaN(t) ? "—" : new Date(t + 9 * 3600 * 1000).toISOString().slice(from, 16).replace("T", " ").replace("-", ".");
};
function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function deviceName(ua: string | null): string {
  if (!ua) return "기기";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "브라우저";
  const os = /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return [b, os].filter(Boolean).join(" · ");
}

export default function Me({ name, email, roleLabel, team }: { name: string; email: string; roleLabel: string; team: string }) {
  return (
    <div className="ed-page">
      <div className="ed-head"><h1 className="ed-h1">내 정보</h1></div>
      <section className="ed-sec q">
        <h2>계정</h2>
        <div>
          <div className="ed-row"><span className="k">이름</span>{name}</div>
          <div className="ed-row"><span className="k">이메일</span>{email || "—"}</div>
          <div className="ed-row"><span className="k">역할</span>{roleLabel}</div>
          <div className="ed-row"><span className="k">소속 팀</span>{team}</div>
        </div>
      </section>
      <Password />
      <Push />
      <Claude />
    </div>
  );
}

function Password() {
  const [cur, setCur] = useState(""); const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/account/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: cur, newPassword: next }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, t: d.error ?? "바꾸지 못했습니다" }); return; }
    setCur(""); setNext(""); setMsg({ ok: true, t: "바꿨습니다 ✓" });
  };
  return (
    <section className="ed-sec q q1">
      <h2>비밀번호</h2>
      <div className="me-pw">
        <input className="ed-input" type="password" autoComplete="current-password" placeholder="지금 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input className="ed-input" type="password" autoComplete="new-password" placeholder="새 비밀번호 · 8자 이상" value={next} onChange={(e) => setNext(e.target.value)} />
        <button type="button" className="ed-btn pri" disabled={busy || !cur || next.length < 8} onClick={() => void save()}>{busy ? "바꾸는 중" : "바꾸기"}</button>
      </div>
      {msg && <div className={msg.ok ? "ed-ok" : "ed-err"} role="status">{msg.t}</div>}
    </section>
  );
}

function Push() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [mine, setMine] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const load = async () => {
    const r = await fetch("/api/push", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json(); setPublicKey(d.publicKey); setKinds(d.kinds); setDevices(d.devices);
  };
  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok) {
      setPerm(Notification.permission);
      navigator.serviceWorker.getRegistration("/").then((reg) => reg?.pushManager.getSubscription()).then((s) => setMine(s?.endpoint ?? null)).catch(() => {});
    }
    setInstalled(window.matchMedia?.("(display-mode: standalone)").matches ?? false);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    void load();
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  const here = devices.find((d) => d.endpoint === mine) ?? null;
  const turnOn = async () => {
    if (!publicKey) return;
    setBusy(true); setMsg("");
    try {
      const p = await Notification.requestPermission(); setPerm(p);
      if (p !== "granted") { setMsg("브라우저에서 알림이 막혀 있습니다"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) { setMsg((await r.json().catch(() => null))?.error ?? "등록하지 못했습니다"); return; }
      setMine(sub.endpoint); await load();
    } catch (e) { setMsg(`켜지 못했습니다 — ${String((e as Error)?.message ?? e).slice(0, 100)}`); }
    finally { setBusy(false); }
  };
  const turnOff = async (d: Device) => {
    if (d.endpoint === mine) {
      const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
      await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
      setMine(null);
    }
    await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) });
    void load();
  };
  const toggleKind = async (k: string) => {
    if (!here) return;
    const next = here.kinds.includes(k) ? here.kinds.filter((x) => x !== k) : [...here.kinds, k];
    setDevices((ds) => ds.map((d) => (d.id === here.id ? { ...d, kinds: next } : d)));
    await fetch("/api/push", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: here.endpoint, kinds: next }) });
  };
  const test = async () => {
    const r = await fetch("/api/push/test", { method: "POST" }).catch(() => null);
    const d = r?.ok ? await r.json() : null;
    setMsg(d ? `시험 알림 ${d.sent}/${d.devices}` : "보내지 못했습니다");
  };
  const doInstall = async () => {
    if (!install) return;
    await install.prompt();
    const c = await install.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (c.outcome === "accepted") setInstalled(true);
    setInstall(null);
  };
  return (
    <section className="ed-sec q q2" id="push">
      <h2>알림 설정</h2>
      <div>
        <div className="ed-row"><span className="k">앱 설치</span>
          {installed ? <span className="ed-ok">설치됨</span> : install ? <button type="button" className="ed-btn sm" onClick={() => void doInstall()}>앱으로 설치</button> : <span className="me-faint">—</span>}
        </div>
        <div className="ed-row"><span className="k">이 기기</span>
          {supported === false ? <span className="me-faint">지원 안 함</span>
            : !publicKey ? <span className="me-faint">알림 서버 키 없음</span>
            : here ? <span className="ed-ok">켜짐</span>
            : perm === "denied" ? <span className="ed-err">브라우저에서 막힘</span>
            : <button type="button" className="ed-btn pri sm" disabled={busy} onClick={() => void turnOn()}>{busy ? "켜는 중" : "알림 켜기"}</button>}
          <span className="ed-sp" />
          {here && <button type="button" className="ed-btn sm" onClick={() => void test()}>시험 알림</button>}
        </div>
        {here && (
          <div className="ed-row" role="group" aria-label="받을 알림"><span className="k">받을 알림</span>
            <div className="ed-chips">{kinds.map((k) => (
              <button key={k.key} type="button" className={`ed-chip${here.kinds.includes(k.key) ? " on" : ""}`} onClick={() => void toggleKind(k.key)}>{k.label}</button>
            ))}</div>
          </div>
        )}
        {devices.map((d) => (
          <div key={d.id} className="ed-row"><span className="k">{deviceName(d.userAgent)}{d.endpoint === mine ? " · 이 기기" : ""}</span>
            <span className="me-faint">{seoul(d.createdAt)} · 마지막 {seoul(d.lastOkAt)}</span><span className="ed-sp" />
            <button type="button" className="ed-btn sm gh red" onClick={() => void turnOff(d)}>끄기</button>
          </div>
        ))}
      </div>
      {msg && <div className="me-faint" role="status">{msg}</div>}
    </section>
  );
}

function Claude() {
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("데스크톱");
  const [made, setMade] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState("");
  const load = async () => { const r = await fetch("/api/tokens", { cache: "no-store" }).catch(() => null); if (r?.ok) setRows((await r.json()).tokens); };
  useEffect(() => { setOrigin(window.location.origin); void load(); }, []);
  const create = async () => {
    setBusy(true); setMsg("");
    const r = await fetch("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setMsg((r && (await r.json().catch(() => null))?.error) || "만들지 못했습니다"); return; }
    setMade((await r.json()).token); void load();
  };
  const revoke = async (t: TokenRow) => {
    if (!window.confirm(`「${t.name}」 키를 끊을까요?`)) return;
    await fetch(`/api/tokens/${t.id}`, { method: "DELETE" }).catch(() => null);
    void load();
  };
  const copy = async (text: string, k: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(""), 1800); } catch { setMsg("복사하지 못했습니다"); }
  };
  const url = `${origin}/api/mcp`;
  const code = made ? `claude mcp add --transport http --scope user teamboard ${url} --header "Authorization: Bearer ${made}"` : "";
  const desktop = made ? JSON.stringify({ mcpServers: { teamboard: { command: "npx", args: ["-y", "mcp-remote", url, "--header", "Authorization:${TB_AUTH}"], env: { TB_AUTH: `Bearer ${made}` } } } }, null, 2) : "";
  return (
    <section className="ed-sec q q3" id="claude">
      <h2>Claude 연결</h2>
      {made ? (
        <div className="me-cc">
          <div className="ed-label">Claude Code</div>
          <pre onClick={() => void copy(code, "code")}>{code}</pre>
          <button type="button" className="ed-btn sm" onClick={() => void copy(code, "code")}>{copied === "code" ? "복사됨 ✓" : "복사"}</button>
          <div className="ed-label">Claude 데스크톱 · claude_desktop_config.json</div>
          <pre onClick={() => void copy(desktop, "desk")}>{desktop}</pre>
          <button type="button" className="ed-btn sm" onClick={() => void copy(desktop, "desk")}>{copied === "desk" ? "복사됨 ✓" : "복사"}</button>
          <ul className="me-tip">
            <li>Claude 데스크톱 → 설정 → 개발자 → 구성 편집. 이미 내용이 있으면 <code>"mcpServers"</code> 안에 <code>teamboard</code> 묶음만 넣습니다(쉼표 주의).</li>
            <li>저장한 뒤 파일 → 종료로 완전히 끄고 다시 켭니다. 개발자 화면에 「실행 중」이면 됩니다.</li>
            <li>키는 지금 한 번만 보입니다. 복사 버튼으로만 옮기고, 채팅 · 캡처에 남기지 마세요.</li>
          </ul>
          <button type="button" className="ed-btn pri" onClick={() => setMade(null)}>완료</button>
        </div>
      ) : (
        <div className="me-pw">
          <input className="ed-input" value={name} maxLength={60} aria-label="키 이름" placeholder="키 이름" onChange={(e) => setName(e.target.value)} />
          <button type="button" className="ed-btn pri" disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? "만드는 중" : "연결 키 만들기"}</button>
        </div>
      )}
      {rows && rows.length > 0 && (
        <div>{rows.map((t) => (
          <div key={t.id} className="ed-row"><span className="k">{t.name}</span><code className="me-code">{t.prefix}…</code>
            <span className="me-faint">{seoul(t.createdAt, 2)} · 마지막 {seoul(t.lastUsedAt, 2)}</span><span className="ed-sp" />
            <button type="button" className="ed-btn sm gh red" onClick={() => void revoke(t)}>끊기</button>
          </div>
        ))}</div>
      )}
      {msg && <div className="ed-err" role="status">{msg}</div>}
    </section>
  );
}
