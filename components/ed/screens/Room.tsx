"use client";

// 회의 — 2026-11 개선: 「자유롭게 올리고 · 함께 보고 · 채팅하고 · 마칠 때 한 번에 저장」.
//
//   왼쪽 스테이지 [자료 | 회의록 | 영상]
//     자료  — 올린 파일 · 링크 보드. 화면 어디에나 끌어 놓기 · 여러 개 · 붙여넣기(최대 50MB).
//             누르면 크게 보고(이미지 · PDF · 영상), 「모두에게 띄우기」면 다른 사람 화면이 따라온다(0049).
//     회의록 — 함께 쓰는 회의록 · 내 메모(0045).   영상 — Jitsi(누를 때만 싣는다).
//   오른쪽 패널 [채팅 | 정리]
//     채팅  — 메시지 · 파일. 말풍선에서 바로 「결정」 · 「할 일」로. 링크는 자료에도 모인다.
//     정리  — 안건(지금 안건 · 다음) · 결정 · 할 일(@담당 → 바로 업무).
//   마치기 — 「회의 끝내기」 하나로: 담을 것(회의록 · 결정·할 일 · 자료 · 채팅 · 내 메모) · PDF/Word 고르고 저장 + 종료.
//            끝난 뒤에도 「기록 저장」으로 다시 받는다.
//
// 실시간은 3초마다 묻기다(lib/meeting.ts 머리말).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initial, isEnter } from "@/lib/ed/core";
import { minutesHtml, saveWord, type MinutesDoc } from "@/lib/ed/minutes-export";
import { uploadMeetingFile } from "@/lib/ed/meeting-upload";
import { Modal, Seg, useToast } from "../ui";
import MeetingNotes, { hm, type NotesState } from "./MeetingNotes";
import StrategyApply from "../StrategyApply";

type Kind = "agenda" | "link" | "decision" | "action" | "note" | "chat" | "file";
interface Item { id: number; kind: Kind; body: string; url: string | null; meta: Record<string, unknown>; createdBy: string; createdById: number; createdAt: string }
interface Attendee { id: number; name: string; present: boolean; joinedAt: string }
export interface MeetingData {
  id: number; title: string; status: "live" | "ended"; room: string; startedAt: string; endedAt: string | null;
  startedById: number; startedBy: string; items: Item[]; attendees: Attendee[]; minutes: unknown;
  notes?: NotesState;
  present?: { itemId: number; by: string; byId: number; at: string } | null;
}
interface Minutes { attendees: string[]; agenda: { body: string; done: boolean }[]; decisions: { body: string }[] }
type Stage = "files" | "notes" | "video";
type Pane = "chat" | "plan";

const REACTS = ["👍", "👏", "🙌", "❓"];
const EXT_BG: Record<string, string> = {
  PDF: "#e5484d", PPTX: "#d98a06", PPT: "#d98a06", XLSX: "#1fa971", XLS: "#1fa971", CSV: "#1fa971", DOCX: "#2f5bea", DOC: "#2f5bea",
  HWP: "#1f8fd6", HWPX: "#1f8fd6", MP4: "#7c5cd6", MOV: "#7c5cd6", WEBM: "#7c5cd6", ZIP: "#586174", LINK: "#0f6b4f",
};
const extOf = (name: string) => (name.split(".").pop() || "FILE").toUpperCase().slice(0, 4);
const isImg = (ext: string) => /^(PNG|JPG|JPEG|GIF|WEBP)$/.test(ext);
const isVid = (ext: string) => /^(MP4|MOV|WEBM)$/.test(ext);
const ts = (s: string) => Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z").replace(/([+-]\d\d)$/, "$1:00"));
const hhmm = (s: string) => { const d = new Date(ts(s) + 9 * 3600e3); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const mmss = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
const mb = (n: unknown) => { const v = Number(n) || 0; return v < 1048576 ? `${Math.max(1, Math.round(v / 1024))}KB` : `${(v / 1048576).toFixed(1)}MB`; };
const host = (u: string | null) => { try { return new URL(u ?? "").hostname.replace(/^www\./, ""); } catch { return u ?? ""; } };
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const reactCount = (it: Item) => Object.entries((it.meta.reactions ?? {}) as Record<string, number[]>).filter(([, v]) => Array.isArray(v) && v.length);
/** 말풍선 글 — 링크는 눌러 열린다 */
function Linked({ text }: { text: string }) {
  const out: React.ReactNode[] = []; let last = 0;
  for (const m of Array.from(text.matchAll(URL_RE))) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<a key={m.index} href={m[0]} target="_blank" rel="noreferrer noopener">{m[0]}</a>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

interface JitsiApi { executeCommand: (c: string) => void; addListener: (e: string, f: (x: Record<string, unknown>) => void) => void; dispose: () => void }
declare global { interface Window { JitsiMeetExternalAPI?: new (domain: string, opts: Record<string, unknown>) => JitsiApi } }

export default function Room({ initial: init, me, lead, domain, people }: {
  initial: MeetingData; me: { id: number; name: string }; lead: boolean; domain: string; people: { id: number; name: string }[];
}) {
  const [m, setM] = useState<MeetingData>(init);
  const [now, setNow] = useState<number | null>(null);
  const ended = m.status === "ended";
  const hasFiles = init.items.some((i) => i.kind === "file" || i.kind === "link");
  const [stage, setStage] = useState<Stage>(hasFiles ? "files" : "notes");
  const [pane, setPane] = useState<Pane>("chat");
  // 확정된 결정 → 운영 전략(지시서 v1 파트 4)
  const [toStrategy, setToStrategy] = useState<{ id: number; body: string } | null>(null);
  const [view, setView] = useState<number | null>(null);          // 자료 크게 보기(항목 번호)
  const [follow, setFollow] = useState(true);                       // 남이 띄운 자료를 따라간다
  const [text, setText] = useState("");
  const [plan, setPlan] = useState({ agenda: "", decision: "", action: "" });
  const [linkText, setLinkText] = useState("");
  const [video, setVideo] = useState(false);
  const [mic, setMic] = useState(true);
  const [share, setShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unread, setUnread] = useState(0);
  const [floats, setFloats] = useState<{ id: number; e: string; x: string }[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [notesNew, setNotesNew] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [saving, setSaving] = useState<"end" | "save" | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const chatRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const api = useRef<JitsiApi | null>(null);
  const seen = useRef<Set<number>>(new Set(init.items.map((i) => i.id)));
  const reacts = useRef<Map<number, number>>(new Map(init.items.map((i) => [i.id, reactCount(i).reduce((a, [, v]) => a + v.length, 0)])));
  const paneRef = useRef(pane); paneRef.current = pane;
  const stageNow = useRef(stage); stageNow.current = stage;
  const dragDepth = useRef(0);

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
      if (others && paneRef.current !== "chat") setUnread((u) => u + others);
    }
    for (const i of d.meeting.items) {
      const n = reactCount(i).reduce((a, [, v]) => a + v.length, 0);
      const prev = reacts.current.get(i.id) ?? 0;
      if (n > prev) { const byOther = reactCount(i).find(([, v]) => v.some((x) => x !== me.id)); if (byOther) burst(byOther[0]); }
      reacts.current.set(i.id, n);
    }
    setM((prev) => {
      const r0 = prev.notes?.rev ?? 0, n1 = d.meeting.notes;
      if (n1 && n1.rev > r0 && n1.by && n1.by !== me.name && stageNow.current !== "notes") setNotesNew(true);
      return d.meeting;
    });
  }, [init.id, me.id, me.name, burst]);

  useEffect(() => {
    setNow(Date.now());
    const c = setInterval(() => setNow(Date.now()), 1000);
    if (ended) return () => clearInterval(c);
    const t = setInterval(() => { if (document.visibilityState === "visible") void pull(); }, 3000);
    return () => { clearInterval(c); clearInterval(t); };
  }, [pull, ended]);

  // ── 모으기 ──────────────────────────────────────────────────
  const chat = useMemo(() => m.items.filter((i) => i.kind === "chat" || i.kind === "file").sort((a, b) => a.id - b.id), [m.items]);
  const by = useCallback((k: Kind) => m.items.filter((i) => i.kind === k).sort((a, b) => a.id - b.id), [m.items]);
  const agenda = by("agenda"), decisions = by("decision"), actions = by("action");
  const cur = agenda.findIndex((a) => !a.meta.done);
  const curItem = cur < 0 ? null : agenda[cur];
  const mats = useMemo(() => m.items.filter((i) => i.kind === "file" || i.kind === "link").sort((a, b) => a.id - b.id), [m.items]);
  const viewing = mats.find((i) => i.id === view) ?? null;
  const present = m.present ?? null;
  const presentedByOther = !!present && present.byId !== me.id;

  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat.length, pane]);
  // 남이 띄우면 따라간다 — 내가 다른 걸 열면 따라가기를 멈춘다
  useEffect(() => {
    if (present && presentedByOther && follow) { setStage("files"); setView(present.itemId); }
  }, [present?.itemId, presentedByOther, follow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view !== null && !mats.some((i) => i.id === view)) setView(null); }, [mats, view]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, domain, m.room, me.name]);
  const toggleMic = () => { if (api.current) api.current.executeCommand("toggleAudio"); else setMic((x) => !x); };
  const toggleShare = () => {
    if (ended) return;
    if (!video) { setVideo(true); setTimeout(() => api.current?.executeCommand("toggleShareScreen"), 2500); return; }
    api.current?.executeCommand("toggleShareScreen");
  };

  // ── 쓰기 ────────────────────────────────────────────────────
  const fail = async (r: Response | null, msg: string) => { const d = r ? await r.json().catch(() => null) : null; showToast(d?.error ?? msg); };
  const send = (url: string, body: unknown, method = "POST") =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const act = async (itemId: number, op: string, extra: Record<string, unknown> = {}) => {
    const r = await send(`/api/meetings/${m.id}/items/${itemId}`, { op, ...extra }, "PATCH");
    if (!r?.ok) await fail(r, "바꾸지 못했습니다");
    void pull();
    return !!r?.ok;
  };
  const host_ = m.startedById === me.id || lead;

  /** 안건 · 결정 · 할 일 올리기(채팅 말풍선에서 바로 바꿀 때도) */
  const addPlan = async (kind: "agenda" | "decision" | "action", raw: string) => {
    const t = raw.trim();
    if (!t || ended) return false;
    if (kind === "action") {
      const w = t.match(/@(\S+)/);
      const who = w ? people.find((p) => p.name === w[1] || p.name.startsWith(w[1])) : undefined;
      const body = t.replace(/@\S+/, "").replace(/\s+/g, " ").trim();
      if (!body) return false;
      const r = await send(`/api/meetings/${m.id}`, { kind: "action", body, meta: { assigneeId: who?.id ?? me.id } });
      if (!r?.ok) { await fail(r, "올리지 못했습니다"); return false; }
      const { id: itemId } = await r.json();
      // 할 일은 바로 업무가 된다(담당 · 업무 규칙은 업무 API 가 지킨다)
      const tr = await send("/api/tasks", { title: body, assigneeId: who?.id ?? me.id, status: "todo" });
      if (tr?.ok) { const d = await tr.json(); const taskId = Number(d.id ?? d.task?.id); if (taskId) await act(itemId, "task", { taskId }); }
    } else {
      const r = await send(`/api/meetings/${m.id}`, { kind, body: t });
      if (!r?.ok) { await fail(r, "올리지 못했습니다"); return false; }
      if (kind === "decision" && host_) { const { id: itemId } = await r.json(); await act(itemId, "decide"); }
    }
    void pull();
    return true;
  };
  const submitPlan = async (kind: "agenda" | "decision" | "action") => {
    if (busy) return;
    setBusy(true);
    try { if (await addPlan(kind, plan[kind])) setPlan((p) => ({ ...p, [kind]: "" })); } finally { setBusy(false); }
  };

  /** 링크 — 자료 보드에 모인다. 채팅에 붙인 링크도 같이 */
  const addLinks = async (urls: string[]) => {
    const have = new Set(mats.filter((i) => i.kind === "link").map((i) => i.url));
    for (const u of urls) if (!have.has(u)) await send(`/api/meetings/${m.id}`, { kind: "link", body: u, url: u });
  };
  const sendChat = async () => {
    const t = text.trim();
    if (!t || busy || ended) return;
    setBusy(true);
    try {
      const r = await send(`/api/meetings/${m.id}/chat`, { body: t });
      if (!r?.ok) return await fail(r, "보내지 못했습니다");
      setText("");
      const urls = t.match(URL_RE);
      if (urls) await addLinks(Array.from(new Set(urls)));
    } finally { setBusy(false); void pull(); }
  };
  const addLink = async () => {
    const t = linkText.trim();
    if (!t) return;
    const r = await send(`/api/meetings/${m.id}`, { kind: "link", body: t, url: t });
    if (!r?.ok) return fail(r, "링크를 올리지 못했습니다");
    setLinkText(""); void pull();
  };

  /** 파일 여러 개 — 하나씩 올리고, 실패한 것만 알린다 */
  const uploadAll = async (files: File[]) => {
    if (ended || !files.length) return;
    setUploading((n) => n + files.length);
    let ok = 0;
    for (const f of files) {
      try { await uploadMeetingFile(m.id, f); ok++; }
      catch (e) { showToast(e instanceof Error ? e.message : "올리지 못했습니다"); }
      finally { setUploading((n) => n - 1); }
    }
    if (ok) { showToast(`자료 ${ok}개를 올렸습니다`); if (stage === "video") setStage("files"); }
    void pull();
  };
  const onDragEnter = (e: React.DragEvent) => { if (ended || !e.dataTransfer.types.includes("Files")) return; dragDepth.current++; setDrag(true); };
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDrag(false); };
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault(); dragDepth.current = 0; setDrag(false);
    void uploadAll(Array.from(e.dataTransfer.files));
  };

  const react = async (e: string) => {
    burst(e);
    const target = [...chat].reverse().find((i) => i.createdById !== me.id) ?? chat[chat.length - 1];
    if (!target || ended) return;
    const r = await send(`/api/meetings/${m.id}/react`, { itemId: target.id, emoji: e });
    if (r?.ok) { reacts.current.set(target.id, (reacts.current.get(target.id) ?? 0) + 1); void pull(); }
  };
  const nextAgenda = async () => { if (curItem && !ended) await act(curItem.id, "toggle"); };
  const checkAction = async (i: Item) => {
    const ok = await act(i.id, "check");
    const taskId = Number(i.meta.taskId);
    if (ok && taskId) await send(`/api/tasks/${taskId}`, { status: i.meta.done ? "todo" : "done" }, "PATCH");
  };
  const presentNow = async (itemId: number | null) => {
    const r = await send(`/api/meetings/${m.id}`, { present: itemId }, "PATCH");
    if (!r?.ok) return fail(r, "띄우지 못했습니다");
    showToast(itemId ? "모두의 화면에 띄웠습니다" : "띄우기를 거뒀습니다");
    void pull();
  };
  const openMat = (id: number | null) => {
    setStage("files"); setView(id);
    if (presentedByOther && id !== present?.itemId) setFollow(false);
  };
  const invite = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { showToast("복사하지 못했습니다"); }
  };

  // ── 보기 ────────────────────────────────────────────────────
  const live = m.attendees.filter((a) => a.present);
  const face = live.length ? live : m.attendees.slice(0, 1);
  const start = ts(m.startedAt);
  const endAt = m.endedAt ? ts(m.endedAt) : null;
  const sec = now === null ? 0 : Math.max(0, Math.floor(((endAt ?? now) - start) / 1000));
  const fileSrc = (i: Item, dl = false) => `/api/meetings/${m.id}/files/${i.id}${dl ? "?dl=1" : ""}`;
  const nameOf = (id: unknown, fallback: string) => people.find((p) => p.id === Number(id))?.name ?? fallback;
  const idx = viewing ? mats.indexOf(viewing) : -1;
  const presentItem = present ? mats.find((i) => i.id === present.itemId) : null;

  // 자료 카드 — 컴포넌트가 아니라 그리기 함수(시계가 1초마다 다시 그려도 그림이 다시 붙지 않게)
  const mat = (i: Item) => {
    const ext = i.kind === "link" ? "LINK" : extOf(i.body);
    const canRm = !ended && (i.createdById === me.id || host_);
    const on = present?.itemId === i.id;
    return (
      <div key={i.id} className={`rm-mat${on ? " on" : ""}`} style={{ animation: newIds.has(i.id) ? "tileIn .4s var(--ease) backwards" : undefined }}>
        <button type="button" className="th" onClick={() => openMat(i.id)} aria-label={`${i.body} 크게 보기`}>
          {i.kind === "file" && isImg(ext) ? <img src={fileSrc(i)} alt="" loading="lazy" />
            : <span className="x" style={{ background: EXT_BG[ext] ?? "#586174" }}>{i.kind === "link" ? "링크" : ext}</span>}
          {on && <em>띄우는 중</em>}
        </button>
        <div className="mt">
          <b title={i.body}>{i.kind === "link" ? host(i.url) || i.body : i.body}</b>
          <small>{i.createdBy} · {i.kind === "file" ? mb(i.meta.size) : "링크"}</small>
        </div>
        {canRm && <button type="button" className="rm" onClick={() => void act(i.id, "remove")} aria-label={`${i.body} 내리기`} title="내리기">✕</button>}
      </div>
    );
  };

  // ── 마치기 · 기록 저장 ───────────────────────────────────────
  const docOf = async (inc: Record<string, boolean>): Promise<MinutesDoc> => {
    const minutes = (m.minutes ?? null) as Minutes | null;
    const d = new Date(start + 9 * 3600e3).toISOString().slice(0, 10);
    const memo = inc.memo ? await fetch(`/api/meetings/${m.id}/memo`, { cache: "no-store" }).then((r) => r.json()).then((x) => String(x.body ?? "")).catch(() => "") : undefined;
    return {
      title: m.title, date: d, time: `${hhmm(m.startedAt)} – ${m.endedAt ? hhmm(m.endedAt) : hhmm(new Date().toISOString())}`,
      attendees: minutes ? minutes.attendees : m.attendees.map((a) => a.name),
      notes: inc.notes ? m.notes?.body ?? "" : "",
      agenda: inc.plan ? (minutes ? minutes.agenda : agenda.map((a) => ({ body: a.body, done: !!a.meta.done }))) : [],
      decisions: inc.plan ? decisions.map((i) => (i.meta.decidedAt ? i.body : `${i.body} (제안)`)) : [],
      actions: inc.plan ? actions.map((i) => ({ body: i.body, who: nameOf(i.meta.assigneeId, i.createdBy), done: !!i.meta.done })) : [],
      links: inc.files ? mats.filter((i) => i.kind === "link").map((i) => ({ body: i.body, url: i.url })) : [],
      files: inc.files ? mats.filter((i) => i.kind === "file").map((i) => ({ name: i.body, who: i.createdBy, size: mb(i.meta.size) })) : undefined,
      chat: inc.chat ? chat.map((c) => ({ who: c.createdBy, at: hhmm(c.createdAt), body: c.kind === "file" ? `[자료] ${c.body}` : c.body })) : undefined,
      memo,
    };
  };
  const finish = async (inc: Record<string, boolean>, fmt: "pdf" | "word", andEnd: boolean) => {
    // PDF 는 인쇄 창을 먼저 연다 — 기다린 뒤에 열면 팝업이 막힌다
    const w = fmt === "pdf" ? window.open("", "_blank") : null;
    if (fmt === "pdf" && !w) { showToast("팝업이 막혔습니다. 이 사이트의 팝업을 허용해 주세요"); return; }
    const d = await docOf(inc);
    if (fmt === "pdf") {
      w!.document.open();
      w!.document.write(minutesHtml(d).replace("</body>", "<script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body>"));
      w!.document.close();
    } else saveWord(d);
    if (andEnd) {
      const r = await fetch(`/api/meetings/${m.id}/end`, { method: "POST" }).catch(() => null);
      if (!r?.ok) { await fail(r, "끝내지 못했습니다"); return; }
      setVideo(false); showToast("회의를 마쳤습니다 · 기록을 저장했습니다");
    } else showToast("기록을 저장했습니다");
    setSaving(null); void pull();
  };
  const endOnly = async () => {
    const r = await fetch(`/api/meetings/${m.id}/end`, { method: "POST" }).catch(() => null);
    if (!r?.ok) return fail(r, "끝내지 못했습니다");
    setVideo(false); setSaving(null); showToast("회의를 마쳤습니다"); void pull();
  };

  return (
    <>
      <div className="rm-head">
        <div className="rm-ttl">
          <Link href="/v3/room" className="ed-crumb">회의 /</Link>
          <div className="rm-tl">
            <h1>{m.title}</h1>
            <span className={`rm-live${ended ? " off" : ""}`}><i />{ended ? "종료됨" : `진행 중 · ${live.length || 1}명`}</span>
          </div>
        </div>
        <div className="rm-hr">
          <span className={`rm-clock tn${ended ? " off" : ""}`}>{mmss(sec)}</span>
          <div className="rm-faces">{face.map((a) => <span key={a.id} title={a.name}>{initial(a.name)}</span>)}</div>
          {!ended && <button type="button" className={`rm-link${copied ? " ok" : ""}`} onClick={() => void invite()}>{copied ? "복사됨 ✓" : "초대 링크"}</button>}
          <button type="button" className="rm-link" onClick={() => setSaving("save")}>기록 저장</button>
          {!ended && host_ && <button type="button" className="rm-end" onClick={() => setSaving("end")}>회의 끝내기</button>}
        </div>
      </div>

      <div className={`rm-main${drag ? " drop" : ""}`} onDragEnter={onDragEnter} onDragLeave={onDragLeave}
           onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={onDrop}>
        {drag && <div className="rm-dropov"><b>놓으면 회의 자료로 올립니다</b><span>여러 개 · 최대 50MB</span></div>}
        <section className="rm-stage">
          <div className="rm-glow" /><div className="rm-dots" />
          <div className="rm-top">
            <div className="rm-sseg" role="tablist" aria-label="스테이지">
              {([["files", `자료${mats.length ? ` ${mats.length}` : ""}`], ["notes", "회의록"], ["video", "영상"]] as [Stage, string][]).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={stage === k} className={stage === k ? "on" : undefined}
                        onClick={() => { setStage(k); if (k === "notes") setNotesNew(false); }}>
                  {l}{k === "notes" && notesNew && <i className="dot" />}
                </button>
              ))}
            </div>
            {stage === "notes" && m.notes?.at && <span className="rm-cur">마지막 수정 · {m.notes.by} {hm(m.notes.at)}</span>}
            {stage !== "notes" && curItem && <span className="rm-cur">지금 안건 · {curItem.body}</span>}
            <span style={{ flex: 1 }} />
            {uploading > 0 && <span className="rm-upl">올리는 중 {uploading}개</span>}
            <span className="rm-rec"><i className={ended ? "off" : undefined} />{ended ? "종료" : `기록 중 · ${mmss(sec)}`}</span>
          </div>

          {present && presentItem && !ended && (
            <div className="rm-pbar">
              <span className="pl">●</span>
              <span className="t">{present.byId === me.id ? "내가" : `${present.by} 님이`} 「{presentItem.body}」 을(를) 모두에게 띄웠습니다</span>
              {present.byId === me.id
                ? <button type="button" onClick={() => void presentNow(null)}>띄우기 그만</button>
                : follow
                  ? <button type="button" onClick={() => setFollow(false)}>따라가기 끄기</button>
                  : <button type="button" className="go" onClick={() => { setFollow(true); openMat(present.itemId); }}>따라가기</button>}
            </div>
          )}

          <div className="rm-body">
            {stage === "files" && (viewing ? (
              <div className="rm-doc">
                <div className="rm-dh">
                  <button type="button" className="b" onClick={() => openMat(null)}>← 자료 목록</button>
                  <span className="x" style={{ background: EXT_BG[viewing.kind === "link" ? "LINK" : extOf(viewing.body)] ?? "#586174" }}>{viewing.kind === "link" ? "링크" : extOf(viewing.body)}</span>
                  <span className="n">{viewing.body}</span><span className="w">{viewing.createdBy}</span>
                  <span className="nav">
                    <button type="button" className="b" disabled={idx <= 0} onClick={() => openMat(mats[idx - 1].id)} aria-label="이전 자료">‹</button>
                    <span className="tn">{idx + 1}/{mats.length}</span>
                    <button type="button" className="b" disabled={idx >= mats.length - 1} onClick={() => openMat(mats[idx + 1].id)} aria-label="다음 자료">›</button>
                  </span>
                  {!ended && (present?.itemId === viewing.id && present.byId === me.id
                    ? <button type="button" className="b" onClick={() => void presentNow(null)}>띄우기 그만</button>
                    : <button type="button" className="b pri" onClick={() => void presentNow(viewing.id)}>모두에게 띄우기</button>)}
                  {viewing.kind === "file"
                    ? <a className="b" href={fileSrc(viewing, true)}>받기</a>
                    : <a className="b" href={viewing.url ?? "#"} target="_blank" rel="noreferrer noopener">새 창</a>}
                </div>
                {(() => {
                  const ext = viewing.kind === "link" ? "LINK" : extOf(viewing.body);
                  if (viewing.kind === "file" && isImg(ext)) return <div className="rm-dv img"><img src={fileSrc(viewing)} alt={viewing.body} /></div>;
                  if (viewing.kind === "file" && ext === "PDF") return <div className="rm-dv"><iframe title={viewing.body} src={fileSrc(viewing)} /></div>;
                  if (viewing.kind === "file" && isVid(ext)) return <div className="rm-dv img"><video src={fileSrc(viewing)} controls playsInline /></div>;
                  return (
                    <div className="rm-dv card">
                      <span className="x" style={{ background: EXT_BG[ext] ?? "#586174" }}>{viewing.kind === "link" ? "링크" : ext}</span>
                      <b>{viewing.kind === "link" ? host(viewing.url) : viewing.body}</b>
                      <small>{viewing.kind === "link" ? viewing.url : `${mb(viewing.meta.size)} · ${viewing.createdBy}`}</small>
                      {viewing.kind === "file"
                        ? <a className="ed-btn pri" href={fileSrc(viewing, true)}>내려받아 열기</a>
                        : <a className="ed-btn pri" href={viewing.url ?? "#"} target="_blank" rel="noreferrer noopener">새 창에서 열기</a>}
                      {viewing.kind === "file" && <em>이 형식은 화면에서 미리 볼 수 없습니다</em>}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="rm-board">
                {!ended && (
                  <div className="rm-bh">
                    <label className="up">+ 파일 올리기<input type="file" multiple onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void uploadAll(fs); }} /></label>
                    <div className="lk">
                      <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="링크 붙여넣기 · Enter" aria-label="링크"
                             onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void addLink(); } }} />
                    </div>
                    <span className="hint">화면 어디에나 끌어 놓아도 됩니다 · 최대 50MB</span>
                  </div>
                )}
                {mats.length ? (
                  <div className="rm-grid">{mats.map(mat)}</div>
                ) : (
                  <div className="rm-bempty">
                    <b>아직 올린 자료가 없습니다</b>
                    <span>{ended ? "이 회의에는 자료가 없습니다" : "파일을 끌어 놓거나 「+ 파일 올리기」 · 채팅에 붙인 링크도 여기 모입니다"}</span>
                  </div>
                )}
              </div>
            ))}
            {stage === "notes" && (
              <MeetingNotes meetingId={m.id} remote={m.notes ?? { body: "", rev: 0, by: null, at: null }}
                            onSaved={(n) => setM((x) => ({ ...x, notes: n }))}
                            doc={() => ({ title: m.title, date: new Date(start + 9 * 3600e3).toISOString().slice(0, 10), time: `${hhmm(m.startedAt)} – ${m.endedAt ? hhmm(m.endedAt) : "진행 중"}`,
                              attendees: m.attendees.map((a) => a.name), agenda: agenda.map((a) => ({ body: a.body, done: !!a.meta.done })),
                              decisions: decisions.filter((i) => i.meta.decidedAt).map((i) => i.body),
                              actions: actions.map((i) => ({ body: i.body, who: nameOf(i.meta.assigneeId, i.createdBy), done: !!i.meta.done })),
                              links: mats.map((i) => ({ body: i.body, url: i.kind === "link" ? i.url : null })) })}
                            digest={() => {
                              const out: string[] = [];
                              const ds = decisions.filter((i) => i.meta.decidedAt);
                              if (ds.length) out.push("[결정]", ...ds.map((x) => `- ${x.body}`));
                              if (actions.length) out.push(...(out.length ? [""] : []), "[할 일]", ...actions.map((a) => `- ${a.body} (@${nameOf(a.meta.assigneeId, a.createdBy)})`));
                              return out.join("\n");
                            }} onToast={showToast} />
            )}
            <div className="rm-jit" ref={stageRef} style={{ display: stage === "video" && video ? undefined : "none" }} />
            {stage === "video" && !video && (
              <div className="rm-off">
                <div className="rm-av"><span className="r1" /><span className="r2" /><b>{initial(me.name)}</b></div>
                {!ended && <button type="button" className="rm-on" onClick={() => setVideo(true)}>영상 켜기</button>}
              </div>
            )}
          </div>
          {floats.map((f) => <span key={f.id} className="rm-float" style={{ left: f.x }}>{f.e}</span>)}
          {stage === "video" && !ended && (
            <div className="rm-dock">
              <div>
                <button type="button" className={mic ? "on" : undefined} onClick={toggleMic}>{mic ? "마이크" : "음소거"}</button>
                <button type="button" className={video ? "on" : undefined} onClick={() => setVideo((v) => !v)}>{video ? "영상 끄기" : "영상 켜기"}</button>
                <button type="button" className={share ? "on" : undefined} onClick={toggleShare}>{share ? "공유 중" : "화면 공유"}</button>
              </div>
            </div>
          )}
        </section>

        <aside className="rm-panel">
          <div className="rm-tabs two" role="tablist">
            <button type="button" role="tab" aria-selected={pane === "chat"} className={pane === "chat" ? "on" : undefined} onClick={() => { setPane("chat"); setUnread(0); }}>
              채팅<span className="tn">{chat.length}</span>{unread > 0 && <b className="bd">{unread}</b>}
            </button>
            <button type="button" role="tab" aria-selected={pane === "plan"} className={pane === "plan" ? "on" : undefined} onClick={() => setPane("plan")}>
              안건 · 결정 · 할 일<span className="tn">{agenda.length + decisions.length + actions.length}</span>
            </button>
          </div>

          {pane === "chat" ? (
            <>
              <div className="rm-chat" ref={chatRef}>
                {chat.map((c, i) => {
                  const mine = c.createdById === me.id;
                  const showName = i === 0 || chat[i - 1].createdById !== c.createdById;
                  const rs = reactCount(c);
                  const ext = extOf(c.body);
                  return (
                    <div key={c.id} className={`rm-msg${mine ? " me" : ""}`} style={{ animation: newIds.has(c.id) ? "msgIn .35s var(--ease) backwards" : undefined }}>
                      {showName && <span className="nm">{mine ? "나" : c.createdBy} · {hhmm(c.createdAt)}</span>}
                      {c.kind === "file" ? (
                        <button type="button" className="rm-file" onClick={() => openMat(c.id)}>
                          {isImg(ext) ? <img className="tb" src={fileSrc(c)} alt="" loading="lazy" /> : <span className="x" style={{ background: EXT_BG[ext] ?? "#586174" }}>{ext}</span>}
                          <span className="tx"><b>{c.body}</b><small>{mb(c.meta.size)} · 크게 보기</small></span>
                        </button>
                      ) : (
                        <div className="rm-bw">
                          <div className="bb"><Linked text={c.body} /></div>
                          {!ended && (
                            <span className="qa">
                              <button type="button" onClick={async () => { if (await addPlan("decision", c.body)) showToast(host_ ? "결정으로 올렸습니다" : "결정 제안으로 올렸습니다"); }}>결정</button>
                              <button type="button" onClick={async () => { if (await addPlan("action", c.body)) showToast("할 일로 올렸습니다 · 업무에도 등록"); }}>할 일</button>
                            </span>
                          )}
                        </div>
                      )}
                      {rs.length > 0 && <span className="rc">{rs.map(([e, v]) => `${e} ${v.length}`).join("  ")}</span>}
                    </div>
                  );
                })}
                {!chat.length && <div className="rm-empty">첫 메시지를 남겨 보세요 · 파일은 끌어 놓거나 붙여넣기</div>}
              </div>
              {!ended && (
                <div className="rm-foot">
                  <div className="rx">{REACTS.map((e) => <button key={e} type="button" onClick={() => void react(e)}>{e}</button>)}</div>
                  <div className="rm-in">
                    <label title="파일 올리기(여러 개)" aria-label="파일 올리기">📎<input type="file" multiple onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void uploadAll(fs); }} /></label>
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지 · Enter" aria-label="메시지"
                           onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void sendChat(); } }}
                           onPaste={(e) => { const fs = Array.from(e.clipboardData?.files ?? []); if (fs.length) { e.preventDefault(); void uploadAll(fs); } }} />
                    <button type="button" className="go" onClick={() => void sendChat()} disabled={!text.trim() || busy}>보내기</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rm-plan">
              <div className="rm-ps">
                <div className="h"><b>안건</b><span className="tn">{agenda.filter((a) => a.meta.done).length}/{agenda.length}</span>
                  {curItem && !ended && <button type="button" className="nx" onClick={() => void nextAgenda()}>다음 →</button>}</div>
                {agenda.map((it, i) => {
                  const done = !!it.meta.done, isCur = i === cur;
                  return (
                    <div key={it.id} className={`rm-it${isCur ? " cur" : ""}${done ? " past" : ""}`}>
                      <span className={`num${isCur ? " cur" : done ? " ok" : ""}`}>{done ? "✓" : i + 1}</span>
                      <div className="tx"><span className="b">{it.body}</span></div>
                      {!ended && (it.createdById === me.id || host_) && <button type="button" className="rm" onClick={() => void act(it.id, "remove")} aria-label="내리기">✕</button>}
                    </div>
                  );
                })}
                {!ended && <PlanIn value={plan.agenda} ph="+ 안건 · Enter" onChange={(v) => setPlan((p) => ({ ...p, agenda: v }))} onEnter={() => void submitPlan("agenda")} />}
              </div>
              <div className="rm-ps">
                <div className="h"><b>결정</b><span className="tn">{decisions.length}</span></div>
                {decisions.map((it) => (
                  <div key={it.id} className="rm-it">
                    <span className={`num${it.meta.decidedAt ? " ok" : ""}`}>{it.meta.decidedAt ? "✓" : "?"}</span>
                    <div className="tx"><span className="b">{it.body}</span><span className="s">{it.meta.decidedAt ? "결정" : "제안"} · {it.createdBy}</span></div>
                    {!it.meta.decidedAt && host_ && !ended && <button type="button" className="ok" onClick={() => void act(it.id, "decide")}>확정</button>}
                    {!!it.meta.decidedAt && <button type="button" className="sg-to" onClick={() => setToStrategy({ id: it.id, body: it.body })}>전략에 반영</button>}
                    {!ended && (it.createdById === me.id || host_) && <button type="button" className="rm" onClick={() => void act(it.id, "remove")} aria-label="내리기">✕</button>}
                  </div>
                ))}
                {!ended && <PlanIn value={plan.decision} ph="+ 결정 사항 · Enter" onChange={(v) => setPlan((p) => ({ ...p, decision: v }))} onEnter={() => void submitPlan("decision")} />}
              </div>
              <div className="rm-ps">
                <div className="h"><b>할 일</b><span className="tn">{actions.filter((a) => a.meta.done).length}/{actions.length}</span></div>
                {actions.map((it) => (
                  <div key={it.id} className={`rm-it${it.meta.done ? " done" : ""}`}>
                    <button type="button" className={`ed-check${it.meta.done ? " on" : ""}`} disabled={ended} aria-label="할 일 완료" onClick={() => void checkAction(it)}>{it.meta.done ? "✓" : ""}</button>
                    <div className="tx"><span className="b">{it.body}</span><span className="s">@{nameOf(it.meta.assigneeId, it.createdBy)}{it.meta.taskId ? " · 업무 등록됨" : ""}</span></div>
                    {!ended && (it.createdById === me.id || host_) && <button type="button" className="rm" onClick={() => void act(it.id, "remove")} aria-label="내리기">✕</button>}
                  </div>
                ))}
                {!ended && <PlanIn value={plan.action} ph="+ 할 일 @담당 · Enter (업무로 등록)" onChange={(v) => setPlan((p) => ({ ...p, action: v }))} onEnter={() => void submitPlan("action")} />}
              </div>
            </div>
          )}
        </aside>
      </div>

      {saving && (
        <SaveModal ending={saving === "end"} counts={{ files: mats.length, chat: chat.length, decisions: decisions.length, actions: actions.length, notes: !!m.notes?.body.trim() }}
                   time={mmss(sec)} people={m.attendees.length}
                   onClose={() => setSaving(null)} onSave={(inc, fmt) => void finish(inc, fmt, saving === "end")} onEndOnly={() => void endOnly()} />
      )}
      {toStrategy && (
        <StrategyApply meetingId={m.id} decision={toStrategy} onClose={() => setToStrategy(null)}
                       onDone={(msg) => { setToStrategy(null); showToast(msg); }} />
      )}
      {toast}
    </>
  );
}

function PlanIn({ value, ph, onChange, onEnter }: { value: string; ph: string; onChange: (v: string) => void; onEnter: () => void }) {
  return (
    <input className="rm-pin" value={value} placeholder={ph} aria-label={ph}
           onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); onEnter(); } }} />
  );
}

/** 마치기 · 기록 저장 — 담을 것과 형식만 고르면 한 번에 */
function SaveModal({ ending, counts, time, people, onClose, onSave, onEndOnly }: {
  ending: boolean; counts: { files: number; chat: number; decisions: number; actions: number; notes: boolean }; time: string; people: number;
  onClose: () => void; onSave: (inc: Record<string, boolean>, fmt: "pdf" | "word") => void; onEndOnly: () => void;
}) {
  const [inc, setInc] = useState({ notes: true, plan: true, files: true, chat: false, memo: false });
  const [fmt, setFmt] = useState<"pdf" | "word">("pdf");
  const opts: [keyof typeof inc, string, string][] = [
    ["notes", "회의록", counts.notes ? "함께 쓴 본문" : "비어 있음"],
    ["plan", "안건 · 결정 · 할 일", `결정 ${counts.decisions} · 할 일 ${counts.actions}`],
    ["files", "자료 · 링크 목록", `${counts.files}개`],
    ["chat", "채팅 기록", `${counts.chat}개`],
    ["memo", "내 메모", "나만 보는 메모"],
  ];
  return (
    <Modal onClose={onClose} label={ending ? "회의 마치기" : "기록 저장"} width={460}>
      <div className="am-h"><b className="rm-sh">{ending ? "회의 마치기" : "회의 기록 저장"}</b><span style={{ flex: 1 }} />
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button></div>
      <div className="am-b">
        <div className="rm-sum"><span><b className="tn">{time}</b>진행</span><span><b className="tn">{people}</b>참석</span><span><b className="tn">{counts.files}</b>자료</span><span><b className="tn">{counts.chat}</b>채팅</span></div>
        <div className="am-f">
          <span>담을 것</span>
          <div className="rm-inc">
            {opts.map(([k, l, s]) => (
              <label key={k} className={inc[k] ? "on" : undefined}>
                <input type="checkbox" checked={inc[k]} onChange={(e) => setInc((x) => ({ ...x, [k]: e.target.checked }))} />
                <b>{l}</b><small>{s}</small>
              </label>
            ))}
          </div>
        </div>
        <div className="am-f">
          <span>형식</span>
          <Seg value={fmt} onChange={setFmt} options={[{ v: "pdf", label: "PDF" }, { v: "word", label: "Word" }]} />
        </div>
      </div>
      <div className="am-foot">
        {ending && <button type="button" className="ed-btn sm gh" onClick={onEndOnly}>저장 없이 끝내기</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-btn sm" onClick={onClose}>취소</button>
        <button type="button" className="ed-btn sm pri" onClick={() => onSave(inc, fmt)}>{ending ? "저장하고 끝내기" : "저장"}</button>
      </div>
    </Modal>
  );
}
