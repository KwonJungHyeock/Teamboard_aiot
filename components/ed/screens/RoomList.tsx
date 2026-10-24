"use client";

// 회의 — 목록 · 새 회의 · 결정 찾기 (디자인 v1.0 프레임에 맞춘 단순한 형태, 시안 없음).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isEnter, md } from "@/lib/ed/core";
import { useToast } from "../ui";

interface Summary { id: number; title: string; status: "live" | "ended"; startedAt: string; endedAt: string | null; startedBy: string; present: number; attendees: number; decisions: number; actions: number }
interface Found { itemId: number; body: string; votes: number; decidedAt: string; meetingId: number; meetingTitle: string; meetingAt: string; by: string }

const kst = (s: string) => new Date(Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z").replace(/([+-]\d\d)$/, "$1:00")) + 9 * 3600e3).toISOString();
const when = (s: string) => { const d = kst(s); return `${md(d.slice(0, 10))} ${d.slice(11, 16)}`; };

export default function RoomList({ initial, decisions: initDec }: { initial: Summary[]; decisions: Found[] }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [dec, setDec] = useState(initDec);
  const [toast, showToast] = useToast();
  const t = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const iv = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch("/api/meetings", { cache: "no-store" }).catch(() => null);
      if (r?.ok) setList((await r.json()).meetings ?? []);
    }, 10000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(async () => {
      const r = await fetch(`/api/meetings/decisions?q=${encodeURIComponent(q)}`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) setDec(((await r.json()).decisions ?? []).slice(0, 30));
    }, 250);
    return () => clearTimeout(t.current);
  }, [q]);

  const start = async () => {
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true);
    const r = await fetch("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: v }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { const d = await r?.json().catch(() => null); return showToast(d?.error ?? "회의를 열지 못했습니다"); }
    const d = await r.json();
    router.push(`/v3/room/${d.id}`);
  };

  const live = list.filter((m) => m.status === "live");
  const past = list.filter((m) => m.status === "ended");

  return (
    <>
      <div className="ed-head"><h1 className="ed-h1">회의</h1></div>
      <div className="ed-comp q">
        <span className="plus">+</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="새 회의 이름 · Enter" aria-label="새 회의"
               onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void start(); } }} />
        <div className="opts"><button type="button" className={`add${title.trim() && !busy ? "" : " off"}`} onClick={() => void start()}>열기</button></div>
      </div>
      <div className="rl-main">
        <section className="rl-sec q q1">
          {live.length > 0 && <div className="rl-gh">진행 중</div>}
          {live.map((m, i) => (
            <Link key={m.id} href={`/v3/room/${m.id}`} className="rl-row live" style={{ animationDelay: `${(i * 0.04).toFixed(2)}s` }}>
              <span className="dt"><i /></span>
              <span className="tt">{m.title}</span>
              <span className="mt">{m.startedBy} · {when(m.startedAt)}</span>
              <span className="nb tn">{m.present}명</span>
              <span className="go">들어가기</span>
            </Link>
          ))}
          <div className="rl-gh">지난 회의</div>
          {past.map((m, i) => (
            <Link key={m.id} href={`/v3/room/${m.id}`} className="rl-row" style={{ animationDelay: `${((live.length + i) * 0.03).toFixed(2)}s` }}>
              <span className="dt"><i /></span>
              <span className="tt">{m.title}</span>
              <span className="mt">{m.startedBy} · {when(m.startedAt)}</span>
              <span className="nb tn">결정 {m.decisions} · 할 일 {m.actions}</span>
            </Link>
          ))}
          {!past.length && <div className="ed-empty">비어 있음</div>}
        </section>
        <aside className="rl-dec q q2">
          <div className="rl-dh"><span>결정</span></div>
          <div className="rl-sr"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="결정 찾기" aria-label="결정 찾기" /></div>
          <div className="rl-dl">
            {dec.map((d) => (
              <Link key={d.itemId} href={`/v3/room/${d.meetingId}`} className="rl-d">
                <b>{d.body}</b><small>{d.meetingTitle} · {md(kst(d.decidedAt).slice(0, 10))}</small>
              </Link>
            ))}
            {!dec.length && <div className="ed-empty">비어 있음</div>}
          </div>
        </aside>
      </div>
      {toast}
    </>
  );
}
