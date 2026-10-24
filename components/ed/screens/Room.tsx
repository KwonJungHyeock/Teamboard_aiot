"use client";

// 회의 — 영상 스테이지 + 패널(채팅 · 안건 · 결정 · 할 일 · 링크) (meeting.dc.html · DESIGN.md 5.10).
//
// 실시간은 3초마다 묻기다(lib/meeting.ts 머리말). 영상 · 화면 공유는 Jitsi 를 「영상 켜기」를 눌렀을 때만 싣는다.
// 채팅 · 파일 · 리액션은 0044 — meeting_item(kind 'chat' · 'file', meta.reactions).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initial, isEnter } from "@/lib/ed/core";
import { Drawer, useToast } from "../ui";

type Kind = "agenda" | "link" | "decision" | "action" | "note" | "chat" | "file";
interface Item { id: number; kind: Kind; body: string; url: string | null; meta: Record<string, unknown>; createdBy: string; createdById: number; createdAt: string }
interface Attendee { id: number; name: string; present: boolean; joinedAt: string }
export interface MeetingData {
  id: number; title: string; status: "live" | "ended"; room: string; startedAt: string; endedAt: string | null;
  startedById: number; startedBy: string; items: Item[]; attendees: Attendee[]; minutes: unknown;
}
interface Minutes {
  attendees: string[]; agenda: { body: string; done: boolean }[]; decisions: { body: string }[]; openProposals: string[];
  actions: { body: string; taskId: number | null }[]; links: { body: string; url: string | null }[];
}
type Tab = "chat" | "agenda" | "decision" | "action" | "link";
const TABS: [Tab, string, string][] = [
  ["chat", "채팅", "메시지 · 파일은 ⌁ 또는 붙여넣기"], ["agenda", "안건", "안건 한 줄 · Enter"], ["decision", "결정", "결정 사항 · Enter"],
  ["action", "할 일", "할 일 @담당 · Enter"], ["link", "링크", "링크 붙여넣기 · Enter"],
];
const REACTS = ["👍", "👏", "🙌", "❓"];
const EXT_BG: Record<string, string> = { PDF: "#e5484d", PPTX: "#d98a06", PPT: "#d98a06", XLSX: "#1fa971", XLS: "#1fa971", DOCX: "#2f5bea", DOC: "#2f5bea" };
const extOf = (name: string) => (name.split(".").pop() || "FILE").toUpperCase().slice(0, 4);
const isImg = (ext: string) => /^(PNG|JPG|JPEG|GIF|WEBP)$/.test(ext);
const ts = (s: string) => Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z").replace(/([+-]\d\d)$/, "$1:00"));
const hhmm = (s: string) => { const d = new Date(ts(s) + 9 * 3600e3); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const mmss = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
const mb = (n: unknown) => `${(Number(n) / 1048576 || 0).toFixed(1)}MB`;
const reactCount = (it: Item) => {
  const r = (it.meta.reactions ?? {}) as Record<string, number[]>;
  return Object.entries(r).filter(([, v]) => Array.isArray(v) && v.length);
};

interface JitsiApi { executeCommand: (c: string) => void; addListener: (e: string, f: (x: Record<string, unknown>) => void) => void; dispose: () => void }
declare global { interface Window { JitsiMeetExternalAPI?: new (domain: string, opts: Record<string, unknown>) => JitsiApi } }

export default function Room({ initial: init, me, lead, domain, people }: {
  initial: MeetingData; me: { id: number; name: string }; lead: boolean; domain: string; people: { id: number; name: string }[];
}) {
  const [m, setM] = useState<MeetingData>(init);
  const [now, setNow] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const [video, setVideo] = useState(false);
  const [mic, setMic] = useState(true);
  const [share, setShare] = useState(false);
  const [doc, setDoc] = useState<Item | null>(null);
  const [copied, setCopied] = useState(false);
  const [unread, setUnread] = useState(0);
  const [floats, setFloats] = useState<{ id: number; e: string; x: string }[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [curN, setCurN] = useState(0);
  const [showMin, setShowMin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const chatRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const api = useRef<JitsiApi | null>(null);
  const seen = useRef<Set<number>>(new Set(init.items.map((i) => i.id)));
  const reacts = useRef<Map<number, number>>(new Map(init.items.map((i) => [i.id, reactCount(i).reduce((a, [, v]) => a + v.length, 0)])));
  const tabRef = useRef(tab); tabRef.current = tab;
  const ended = m.status === "ended";

  const burst = useCallback((e: string) => {
    const id = Date.now() + Math.random();
    setFloats((fs) => [...fs, { id, e, x: `${20 + Math.random() * 50}%` }]);
    setTimeout(() => setFloats((fs) => fs.filter((f) => f.id !== id)), 1900);
  }, []);

  const pull = useCallback(async () => {
    const r = await fetch(`/api/meetings/${init.id}`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as { meeting: MeetingData };
    const fresh = d.meeting.items.filter((i) => !seen.current.has(i.id));
    if (fresh.length) {
      fresh.forEach((i) => seen.current.add(i.id));
      setNewIds(new Set(fresh.map((i) => i.id)));
      const others = fresh.filter((i) => (i.kind === "chat" || i.kind === "file") && i.createdById !== me.id).length;
      if (others && tabRef.current !== "chat") setUnread((u) => u + others);
    }
    // 남이 누른 리액션은 스테이지 위로 한 번 띄운다
    for (const i of d.meeting.items) {
      const n = reactCount(i).reduce((a, [, v]) => a + v.length, 0);
      const prev = reacts.current.get(i.id) ?? 0;
      if (n > prev) {
        const byOther = reactCount(i).find(([, v]) => v.some((x) => x !== me.id));
        if (byOther) burst(byOther[0]);
      }
      reacts.current.set(i.id, n);
    }
    setM(d.meeting);
  }, [init.id, me.id, burst]);

  useEffect(() => {
    setNow(Date.now());
    const c = setInterval(() => setNow(Date.now()), 1000);
    if (ended) return () => clearInterval(c);
    const t = setInterval(() => { if (document.visibilityState === "visible") void pull(); }, 3000);
    return () => { clearInterval(c); clearInterval(t); };
  }, [pull, ended]);

  const chat = useMemo(() => m.items.filter((i) => i.kind === "chat" || i.kind === "file").sort((a, b) => a.id - b.id), [m.items]);
  const by = useCallback((k: Kind) => m.items.filter((i) => i.kind === k).sort((a, b) => a.id - b.id), [m.items]);
  const agenda = by("agenda");
  const cur = agenda.findIndex((a) => !a.meta.done);
  const curIdx = cur < 0 ? agenda.length : cur;
  const curItem = cur < 0 ? null : agenda[cur];
  const files = chat.filter((i) => i.kind === "file");
  const links = [...by("link"), ...files].sort((a, b) => a.id - b.id);

  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat.length, tab]);

  // ── 영상(Jitsi) ─────────────────────────────────────────────
  useEffect(() => {
    if (!video || !stageRef.current) return;
    let gone = false;
    const mount = () => {
      if (gone || !stageRef.current || !window.JitsiMeetExternalAPI) return;
      api.current = new window.JitsiMeetExternalAPI(domain, {
        roomName: m.room, parentNode: stageRef.current, width: "100%", height: "100%",
        userInfo: { displayName: me.name },
        configOverwrite: { prejoinPageEnabled: false, startWithAudioMuted: !mic },
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: [] },
      });
      api.current.addListener("audioMuteStatusChanged", (x) => setMic(!x.muted));
      api.current.addListener("screenSharingStatusChanged", (x) => setShare(!!x.on));
    };
    if (window.JitsiMeetExternalAPI) mount();
    else {
      const sc = document.createElement("script");
      sc.src = `https://${domain}/external_api.js`; sc.async = true; sc.onload = mount;
      sc.onerror = () => { if (!gone) { showToast("영상 서버에 연결하지 못했습니다"); setVideo(false); } };
      document.head.appendChild(sc);
    }
    return () => { gone = true; api.current?.dispose(); api.current = null; setShare(false); };
    // mic 은 시작값으로만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, domain, m.room, me.name]);

  const toggleMic = () => { if (api.current) api.current.executeCommand("toggleAudio"); else setMic((x) => !x); };
  const toggleShare = () => {
    if (ended) return;
    if (!video) { setVideo(true); setTimeout(() => api.current?.executeCommand("toggleShareScreen"), 2500); return; }
    api.current?.executeCommand("toggleShareScreen");
  };

  // ── 쓰기 ────────────────────────────────────────────────────
  const fail = async (r: Response | null, msg: string) => {
    const d = r ? await r.json().catch(() => null) : null;
    showToast(d?.error ?? msg);
  };
  const post = async (url: string, body: unknown, method = "POST") => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    return r;
  };
  const act = async (itemId: number, op: string, extra: Record<string, unknown> = {}) => {
    const r = await post(`/api/meetings/${m.id}/items/${itemId}`, { op, ...extra }, "PATCH");
    if (!r?.ok) await fail(r, "바꾸지 못했습니다");
    void pull();
    return !!r?.ok;
  };

  const add = async () => {
    const t = text.trim();
    if (!t || busy || ended) return;
    setBusy(true);
    try {
      if (tab === "chat") {
        const r = await post(`/api/meetings/${m.id}/chat`, { body: t });
        if (!r?.ok) return await fail(r, "보내지 못했습니다");
      } else if (tab === "action") {
        const w = t.match(/@(\S+)/);
        const who = w ? people.find((p) => p.name === w[1] || p.name.startsWith(w[1])) : undefined;
        const body = t.replace(/@\S+/, "").replace(/\s+/g, " ").trim();
        if (!body) return;
        const r = await post(`/api/meetings/${m.id}`, { kind: "action", body, meta: { assigneeId: who?.id ?? me.id } });
        if (!r?.ok) return await fail(r, "올리지 못했습니다");
        const { id: itemId } = await r.json();
        // 할 일은 바로 업무가 된다(담당 · 업무 규칙은 업무 API 가 지킨다)
        const tr = await post("/api/tasks", { title: body, assigneeId: who?.id ?? me.id, status: "todo" });
        if (tr?.ok) { const d = await tr.json(); const taskId = Number(d.id ?? d.task?.id); if (taskId) await act(itemId, "task", { taskId }); }
      } else {
        const r = await post(`/api/meetings/${m.id}`, tab === "link" ? { kind: "link", body: t, url: t } : { kind: tab, body: t });
        if (!r?.ok) return await fail(r, "올리지 못했습니다");
        if (tab === "decision" && (m.startedById === me.id || lead)) {
          const { id: itemId } = await r.json();
          await act(itemId, "decide");
        }
      }
      setText("");
    } finally { setBusy(false); void pull(); }
  };

  const upload = async (f: File) => {
    if (ended) return;
    const name = f.name || "붙여넣은 이미지.png";
    const r = await fetch(`/api/meetings/${m.id}/files?name=${encodeURIComponent(name)}`, {
      method: "POST", headers: { "content-type": f.type || "application/octet-stream" }, body: f,
    }).catch(() => null);
    if (!r?.ok) return fail(r, "파일을 올리지 못했습니다");
    void pull();
  };

  const react = async (e: string) => {
    burst(e);
    const target = [...chat].reverse().find((i) => i.createdById !== me.id) ?? chat[chat.length - 1];
    if (!target || ended) return;
    const r = await post(`/api/meetings/${m.id}/react`, { itemId: target.id, emoji: e });
    if (r?.ok) {
      reacts.current.set(target.id, (reacts.current.get(target.id) ?? 0) + 1);
      void pull();
    }
  };

  const nextAgenda = async () => {
    if (!curItem || ended) return;
    setCurN((x) => x + 1);
    await act(curItem.id, "toggle");
  };

  const checkAction = async (i: Item) => {
    const ok = await act(i.id, "check");
    const taskId = Number(i.meta.taskId);
    if (ok && taskId) await post(`/api/tasks/${taskId}`, { status: i.meta.done ? "todo" : "done" }, "PATCH");
  };

  const invite = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { showToast("복사하지 못했습니다"); }
  };
  const end = async () => {
    if (ended) { setShowMin(true); return; }
    if (!window.confirm("회의를 끝낼까요?")) return;
    const r = await fetch(`/api/meetings/${m.id}/end`, { method: "POST" }).catch(() => null);
    if (!r?.ok) return fail(r, "끝내지 못했습니다");
    setVideo(false);
    void pull();
  };

  // ── 보기 ────────────────────────────────────────────────────
  const present = m.attendees.filter((a) => a.present);
  const face = present.length ? present : m.attendees.slice(0, 1);
  const start = ts(m.startedAt);
  const endAt = m.endedAt ? ts(m.endedAt) : null;
  const sec = now === null ? 0 : Math.max(0, Math.floor(((endAt ?? now) - start) / 1000));
  const canEnd = m.startedById === me.id || lead;
  const count = (k: Tab) => (k === "chat" ? chat.length : k === "link" ? links.length : by(k as Kind).length);
  const rows = tab === "link" ? links : tab === "chat" ? [] : by(tab as Kind);
  const minutes = (m.minutes ?? null) as Minutes | null;
  const docExt = doc ? extOf(doc.body) : "";
  const docSrc = doc ? `/api/meetings/${m.id}/files/${doc.id}` : "";

  return (
    <>
      <div className="rm-head">
        <div className="rm-ttl">
          <Link href="/v3/room" className="ed-crumb">회의 /</Link>
          <div className="rm-tl">
            <h1>{m.title}</h1>
            <span className={`rm-live${ended ? " off" : ""}`}><i />{ended ? "종료됨" : `진행 중 · ${present.length || 1}명`}</span>
          </div>
        </div>
        <div className="rm-hr">
          <span className={`rm-clock tn${ended ? " off" : ""}`}>{mmss(sec)}</span>
          <div className="rm-faces">{face.map((a) => <span key={a.id} title={a.name}>{initial(a.name)}</span>)}</div>
          <button type="button" className={`rm-link${copied ? " ok" : ""}`} onClick={() => void invite()}>{copied ? "복사됨 ✓" : "초대 링크"}</button>
          {(canEnd || ended) && <button type="button" className={`rm-end${ended ? " off" : ""}`} onClick={() => void end()}>{ended ? "회의록 보기" : "회의 끝내기"}</button>}
        </div>
      </div>

      <div className="rm-main">
        <section className="rm-stage">
          <div className="rm-glow" /><div className="rm-dots" />
          <div className="rm-top">
            <span className="rm-rec"><i className={ended ? "off" : undefined} />{ended ? "종료" : `기록 중 · ${mmss(sec)}`}</span>
            <span className="rm-cur">{curItem?.body ?? ""}</span>
          </div>
          <div className="rm-body">
            {doc && (
              <div className="rm-doc">
                <div className="rm-dh">
                  <span className="x" style={{ background: EXT_BG[docExt] ?? "#586174" }}>{docExt}</span>
                  <span className="n">{doc.body}</span><span className="w">{doc.createdBy} 공유</span>
                  <a className="b" href={docSrc} target="_blank" rel="noreferrer">열기</a>
                  <button type="button" className="b" onClick={() => setDoc(null)}>닫기</button>
                </div>
                <div className={`rm-dv${isImg(docExt) ? " img" : ""}`}>
                  {isImg(docExt) ? <img src={docSrc} alt={doc.body} />
                    : docExt === "PDF" ? <iframe title={doc.body} src={docSrc} />
                    : <div className="sk"><i style={{ width: "45%" }} />{[92, 84, 88, 60, 0, 90, 76, 82, 40].map((w, k) => <b key={k} style={{ width: `${w}%` }} />)}</div>}
                </div>
              </div>
            )}
            <div className="rm-jit" ref={stageRef} style={{ display: video && !doc ? undefined : "none" }} />
            {!video && !doc && (
              <div className="rm-off">
                <div className="rm-av"><span className="r1" /><span className="r2" /><b>{initial(me.name)}</b></div>
                {!ended && <button type="button" className="rm-on" onClick={() => setVideo(true)}>영상 켜기</button>}
              </div>
            )}
          </div>
          {floats.map((f) => <span key={f.id} className="rm-float" style={{ left: f.x }}>{f.e}</span>)}
          <div className="rm-dock">
            <div>
              <button type="button" className={mic ? "on" : undefined} onClick={toggleMic}>{mic ? "마이크" : "음소거"}</button>
              <button type="button" className={video ? "on" : undefined} onClick={() => !ended && setVideo((v) => !v)}>{video ? "영상 끄기" : "영상 켜기"}</button>
              <button type="button" className={share ? "on" : undefined} onClick={toggleShare}>{share ? "공유 중" : "화면 공유"}</button>
              <button type="button" className={tab === "chat" ? "on" : undefined} onClick={() => { setTab("chat"); setUnread(0); }}>
                채팅{unread > 0 && <span className="bd">{unread}</span>}
              </button>
            </div>
          </div>
        </section>

        <aside className="rm-panel">
          <div className="rm-ag">
            <span className="k">지금 안건 · {Math.min(curIdx + 1, agenda.length)}/{agenda.length}</span>
            <div className="r">
              <span className="t" key={curN} style={{ animation: curN ? `${curN % 2 ? "detA" : "detB"} .35s var(--ease) backwards` : undefined }}>
                {curItem?.body ?? (agenda.length ? "모든 안건 완료" : "안건 없음")}
              </span>
              <button type="button" onClick={() => void nextAgenda()} disabled={!curItem || ended}>다음 →</button>
            </div>
            <div className="bar"><i style={{ width: agenda.length ? `${(curIdx / agenda.length) * 100}%` : "0%" }} /></div>
          </div>
          <div className="rm-tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined}
                      onClick={() => { setTab(k); if (k === "chat") setUnread(0); }}>
                {label}<span className="tn">{count(k)}</span>
              </button>
            ))}
          </div>

          {tab === "chat" ? (
            <div className="rm-chat" ref={chatRef}>
              {chat.map((c, i) => {
                const mine = c.createdById === me.id;
                const showName = !mine && (i === 0 || chat[i - 1].createdById !== c.createdById);
                const rs = reactCount(c);
                const ext = extOf(c.body);
                return (
                  <div key={c.id} className={`rm-msg${mine ? " me" : ""}`} style={{ animation: newIds.has(c.id) ? "msgIn .35s var(--ease) backwards" : undefined }}>
                    {showName && <span className="nm">{c.createdBy} · {hhmm(c.createdAt)}</span>}
                    {c.kind === "file" ? (
                      <button type="button" className="rm-file" onClick={() => setDoc(c)}>
                        <span className="x" style={{ background: EXT_BG[ext] ?? "#586174" }}>{ext}</span>
                        <span className="tx"><b>{c.body}</b><small>{mb(c.meta.size)} · 화면에 띄우기</small></span>
                      </button>
                    ) : <div className="bb">{c.body}</div>}
                    {rs.length > 0 && <span className="rc">{rs.map(([e, v]) => `${e} ${v.length}`).join("  ")}</span>}
                  </div>
                );
              })}
              {!chat.length && <div className="rm-empty">비어 있음</div>}
            </div>
          ) : (
            <div className="rm-list">
              {rows.map((it, i) => {
                const isAg = tab === "agenda", isCur = isAg && i === cur, done = isAg ? !!it.meta.done : !!it.meta.done;
                const sub = tab === "action"
                  ? `@${people.find((p) => p.id === Number(it.meta.assigneeId))?.name ?? it.createdBy}`
                  : tab === "decision" ? `${it.meta.decidedAt ? "결정" : "제안"} · ${it.createdBy}`
                  : tab === "link" ? (it.kind === "file" ? `${mb(it.meta.size)} · ${it.createdBy}` : it.createdBy) : null;
                const canRm = !ended && (it.createdById === me.id || canEnd) && it.kind !== "file";
                return (
                  <div key={it.id} className={`rm-it${isCur ? " cur" : ""}${done && !isAg ? " done" : ""}${done && isAg ? " past" : ""}`}
                       style={{ animation: newIds.has(it.id) ? "rowIn .35s var(--ease) backwards" : undefined }}>
                    {isAg && <span className={`num${isCur ? " cur" : done ? " ok" : ""}`}>{done ? "✓" : i + 1}</span>}
                    {tab === "action" && (
                      <button type="button" className={`ed-check${it.meta.done ? " on" : ""}`} disabled={ended} aria-label="할 일 완료"
                              onClick={() => void checkAction(it)}>{it.meta.done ? "✓" : ""}</button>
                    )}
                    <div className="tx">
                      {tab === "link"
                        ? (it.kind === "file"
                          ? <button type="button" className="lk" onClick={() => setDoc(it)}>{it.body}</button>
                          : <a className="lk" href={it.url ?? "#"} target="_blank" rel="noreferrer">{it.body}</a>)
                        : <span className="b">{it.body}</span>}
                      {sub && <span className="s">{sub}</span>}
                    </div>
                    {tab === "decision" && !it.meta.decidedAt && canEnd && !ended && (
                      <button type="button" className="ok" onClick={() => void act(it.id, "decide")}>확정</button>
                    )}
                    {canRm && <button type="button" className="rm" onClick={() => void act(it.id, "remove")} aria-label="내리기">✕</button>}
                  </div>
                );
              })}
              {!rows.length && <div className="rm-empty">비어 있음</div>}
            </div>
          )}

          {!ended && (
            <div className="rm-foot">
              {tab === "chat" && <div className="rx">{REACTS.map((e) => <button key={e} type="button" onClick={() => void react(e)}>{e}</button>)}</div>}
              <div className="rm-in">
                {tab === "chat"
                  ? <label title="이미지 · 문서">⌁<input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} /></label>
                  : <span className="pl">+</span>}
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder={TABS.find((t) => t[0] === tab)![2]}
                       aria-label={TABS.find((t) => t[0] === tab)![1]}
                       onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void add(); } }}
                       onPaste={(e) => { const f = e.clipboardData?.files?.[0]; if (f && tab === "chat") { e.preventDefault(); void upload(f); } }} />
              </div>
            </div>
          )}
        </aside>
      </div>

      {showMin && minutes && (
        <Drawer onClose={() => setShowMin(false)} width={460} label="회의록">
          <div className="dh"><div style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>회의록</div>
            <button type="button" className="ed-x" onClick={() => setShowMin(false)} aria-label="닫기">✕</button></div>
          <div className="db rm-min">
            <div className="ed-field"><span>참석</span><p>{minutes.attendees.join(" · ") || "—"}</p></div>
            <div className="ed-field"><span>안건</span>{minutes.agenda.length ? minutes.agenda.map((a, k) => <p key={k}>{a.done ? "✓ " : "· "}{a.body}</p>) : <p className="f">없음</p>}</div>
            <div className="ed-field"><span>결정</span>{minutes.decisions.length ? minutes.decisions.map((a, k) => <p key={k}>{a.body}</p>) : <p className="f">없음</p>}</div>
            <div className="ed-field"><span>할 일</span>{minutes.actions.length ? minutes.actions.map((a, k) => (
              <p key={k}>{a.taskId ? <Link href={`/v3/room/${m.id}?task=${a.taskId}`} scroll={false}>{a.body}</Link> : a.body}</p>)) : <p className="f">없음</p>}</div>
            <div className="ed-field"><span>링크</span>{minutes.links.length ? minutes.links.map((a, k) => <p key={k}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.body}</a> : a.body}</p>) : <p className="f">없음</p>}</div>
            {m.endedAt && <p className="f">{hhmm(m.startedAt)} – {hhmm(m.endedAt)}</p>}
          </div>
        </Drawer>
      )}
      {toast}
    </>
  );
}
