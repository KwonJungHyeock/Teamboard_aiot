"use client";

// 내 정보 → 알림 · 앱 설치 (2026-10 알림 A · 0041).
//
// 「이 기기에서 알림 켜기」 한 번이면 끝나게 한다: 허락 묻기 → 서비스 워커 → 구독 → 서버 등록.
// 기기마다 따로다(회사 데스크톱에서 켜도 노트북에는 안 온다). 받을 종류도 기기마다 고른다.
import { useEffect, useState } from "react";
import { Button, Card } from "./parts";

interface Kind { key: string; label: string }
interface Device { id: number; endpoint: string; kinds: string[]; userAgent: string | null; createdAt: string; lastOkAt: string | null }
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
/** DB 시각(UTC 글자) → 서울 「MM-DD HH:MM」 */
function seoul(s: string | null): string {
  const t = s ? Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z")) : NaN;
  return Number.isNaN(t) ? "아직 없음" : new Date(t + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
}
/** 「Chrome · Mac」 정도로만 — 기기 목록에서 어느 것인지 알아보게 */
function deviceName(ua: string | null): string {
  if (!ua) return "알 수 없는 기기";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "브라우저";
  const os = /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return [b, os].filter(Boolean).join(" · ");
}

export default function PushSettings() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [mine, setMine] = useState<string | null>(null);        // 이 기기의 주소
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  const load = async () => {
    const r = await fetch("/api/push", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json();
    setPublicKey(d.publicKey); setKinds(d.kinds); setDevices(d.devices);
  };
  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok) {
      setPerm(Notification.permission);
      navigator.serviceWorker.getRegistration("/").then((reg) => reg?.pushManager.getSubscription())
        .then((s) => setMine(s?.endpoint ?? null)).catch(() => {});
    }
    setInstalled(window.matchMedia?.("(display-mode: standalone)").matches ?? false);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    load();
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const here = devices.find((d) => d.endpoint === mine) ?? null;

  const turnOn = async () => {
    if (!publicKey) return;
    setBusy(true); setMsg("");
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") { setMsg("브라우저가 알림을 막았습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔 주세요."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) { setMsg((await r.json().catch(() => null))?.error ?? "등록하지 못했습니다."); return; }
      setMine(sub.endpoint);
      setMsg("이 기기에서 알림을 켰습니다 — 「시험 알림」으로 확인해 보세요");
      await load();
    } catch (e) {
      setMsg(`알림을 켜지 못했습니다 — ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    } finally { setBusy(false); }
  };
  const turnOff = async (d: Device) => {
    if (d.endpoint === mine) {
      const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
      await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
      setMine(null);
    }
    await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) });
    setMsg(`${deviceName(d.userAgent)} 알림을 껐습니다`);
    load();
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
    setMsg(d ? `시험 알림 — 기기 ${d.devices}대 중 ${d.sent}대로 보냈습니다` : "보내지 못했습니다.");
  };
  const doInstall = async () => {
    if (!install) return;
    await install.prompt();
    const c = await install.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (c.outcome === "accepted") setInstalled(true);
    setInstall(null);
  };

  return (
    <Card title="알림 · 앱 설치" sub="이 기기 기준">
      <div className="v3-pn-row">
        <b>앱으로 설치</b>
        {installed ? <span className="v3-pn-ok">설치된 앱에서 보고 있습니다</span>
          : install ? <Button onClick={() => void doInstall()}>앱으로 설치</Button>
          : <span className="v3-why">Chrome · Edge: 주소창 오른쪽의 설치 아이콘 · Safari(Mac): 파일 → Dock에 추가</span>}
      </div>

      <div className="v3-pn-row">
        <b>데스크톱 알림</b>
        {supported === false ? <span className="v3-why">이 브라우저는 알림을 지원하지 않습니다.</span>
          : !publicKey ? <span className="v3-why">알림 서버 설정이 아직 없습니다 — 관리자에게 알려 주세요(VAPID 키).</span>
          : here ? <span className="v3-pn-ok">이 기기에서 켜져 있습니다</span>
          : perm === "denied" ? <span className="v3-why">브라우저가 알림을 막아 두었습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용 후 다시 누르세요.</span>
          : <Button primary disabled={busy} onClick={() => void turnOn()}>{busy ? "켜는 중…" : "이 기기에서 알림 켜기"}</Button>}
        {here && <Button onClick={() => void test()}>시험 알림</Button>}
      </div>

      {here && (
        <div className="v3-pn-kinds" role="group" aria-label="이 기기에서 받을 알림">
          {kinds.map((k) => (
            <label key={k.key} className="v3-pn-k">
              <input type="checkbox" checked={here.kinds.includes(k.key)} onChange={() => void toggleKind(k.key)} /> {k.label}
            </label>
          ))}
        </div>
      )}

      {devices.length > 0 && (
        <ul className="v3-cc-list">
          {devices.map((d) => (
            <li key={d.id}>
              <b>{deviceName(d.userAgent)}{d.endpoint === mine ? " (이 기기)" : ""}</b>
              <span>켠 때 {seoul(d.createdAt)} · 마지막 도착 {seoul(d.lastOkAt)}</span>
              <button type="button" className="v3-cc-x" onClick={() => void turnOff(d)}>끄기</button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="v3-why" role="status">{msg}</p>}
    </Card>
  );
}
