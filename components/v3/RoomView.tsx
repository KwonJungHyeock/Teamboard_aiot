"use client";

// 회의 하나 — 왼쪽은 영상(Jitsi 내장), 오른쪽은 안건 · 링크 · 결정 · 할 일 (0038).
//
// ── 영상은 누르기 전에 켜지 않는다 ─────────────────────────────────
// 들어오자마자 카메라 · 마이크 허락 창이 뜨면 「회의록만 보러 온」 사람이 놀란다.
// 「영상 켜기」를 눌러야 Jitsi 를 싣는다. 화면 공유도 Jitsi 의 버튼으로 한다.
//
// ── 실시간은 2.5초마다 묻기 ───────────────────────────────────────
// 묻는 것이 곧 「여기 있다」다(`/api/meetings/{id}` GET 이 남긴다). 끝난 회의는 묻지 않는다.
//
// ── 끝내면 ───────────────────────────────────────────────────────
// 회의록이 굳고(서버), 참석자 각자의 「내 기록」에 「회의」 한 줄이 남는다.
// 할 일은 「업무로 만들기」를 눌러야 업무가 된다 — 회의에서 말한 것이 전부 업무가 되면
// 업무 목록이 말로 찬다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, Button } from "./parts";

type Kind = "agenda" | "link" | "decision" | "action" | "note";
interface Item {
  id: number; kind: Kind; body: string; url: string | null; meta: Record<string, unknown>;
  createdBy: string; createdById: number; createdAt: string;
}
interface Attendee { id: number; name: string; present: boolean; joinedAt: string }
interface Meeting {
  id: number; title: string; status: "live" | "ended"; room: string; startedAt: string; endedAt: string | null;
  startedById: number; startedBy: string; items: Item[]; attendees: Attendee[]; minutes: unknown;
}
interface Minutes {
  title: string; startedAt: string; endedAt: string; attendees: string[];
  agenda: { body: string; done: boolean }[]; decisions: { body: string; votes: number }[];
  openProposals: string[]; actions: { body: string; taskId: number | null }[];
  links: { body: string; url: string | null }[]; notes: string[];
}
interface Person { id: number; name: string }

const TABS: { kind: Exclude<Kind, "note">; label: string; hint: string }[] = [
  { kind: "agenda", label: "안건", hint: "안건 한 줄 — 엔터로 올립니다" },
  { kind: "link", label: "링크", hint: "링크를 붙여넣고 엔터 — 회의록에 남습니다" },
  { kind: "decision", label: "결정", hint: "정할 것 한 줄 — 찬성을 모으고, 연 사람이 확정합니다" },
  { kind: "action", label: "할 일", hint: "할 일 한 줄 — 담당 · 기한을 고르고 엔터" },
];

const ts = (s: string | null) => (s ? Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z")) : NaN);
function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function seoul(s: string | null): string {
  const t = ts(s);
  if (Number.isNaN(t)) return "";
  const k = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${k.slice(5, 10)} ${k.slice(11, 16)}`;
}
const votesOf = (i: Item) => (Array.isArray(i.meta.votes) ? (i.meta.votes as number[]) : []);

export default function RoomView({ initial, me, lead, domain, people }: {
  initial: Meeting; me: Person; lead: boolean; domain: string; people: Person[];
}) {
  const [m, setM] = useState<Meeting>(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]["kind"]>("agenda");
  const [text, setText] = useState("");
  const [who, setWho] = useState<number>(me.id);
  const [due, setDue] = useState("");
  const [video, setVideo] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  const live = m.status === "live";
  const host = m.startedById === me.id || lead;

  const pull = useCallback(async () => {
    const r = await fetch(`/api/meetings/${m.id}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setM((await r.json()).meeting);
  }, [m.id]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(pull, 2500);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [live, pull]);

  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 3500); return () => clearTimeout(t); }, [note]);

  const fail = async (r: Response | null, fallback: string) =>
    setNote((r && (await r.json().catch(() => null))?.error) || fallback);

  const add = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const payload: Record<string, unknown> = { kind: tab, body };
    if (tab === "link") payload.url = body;
    if (tab === "action") payload.meta = { assigneeId: who, due: due || undefined };
    const r = await fetch(`/api/meetings/${m.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return fail(r, "올리지 못했습니다.");
    setText("");
    input.current?.focus();
    pull();
  };

  const act = async (itemId: number, op: string, extra: Record<string, unknown> = {}) => {
    const r = await fetch(`/api/meetings/${m.id}/items/${itemId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, ...extra }),
    }).catch(() => null);
    if (!r?.ok) await fail(r, "바꾸지 못했습니다.");
    pull();
    return !!r?.ok;
  };

  // 할 일 → 업무. 업무는 업무 API 가 만든다(영역 · 공개 범위 규칙이 거기 있다)
  const toTask = async (i: Item) => {
    const assigneeId = Number(i.meta.assigneeId) || me.id;
    const r = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: i.body, assigneeId, dueDate: typeof i.meta.due === "string" ? i.meta.due : undefined }),
    }).catch(() => null);
    if (!r?.ok) return fail(r, "업무를 만들지 못했습니다.");
    const t = await r.json();
    const id = Number(t.id ?? t.task?.id);
    if (id && (await act(i.id, "task", { taskId: id }))) setNote(`업무 #${id} 를 만들었습니다`);
  };

  const end = async () => {
    if (!window.confirm("회의를 끝낼까요? 회의록이 굳고, 참석자 각자의 내 기록에 한 줄씩 남습니다.")) return;
    const r = await fetch(`/api/meetings/${m.id}/end`, { method: "POST" }).catch(() => null);
    if (!r?.ok) return fail(r, "끝내지 못했습니다.");
    setVideo(false);
    pull();
  };

  const invite = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setNote("초대 링크를 복사했습니다 — 팀원에게 보내세요"); }
    catch { setNote("복사하지 못했습니다 — 주소창의 주소를 보내세요"); }
  };

  const items = useMemo(() => {
    const by: Record<Kind, Item[]> = { agenda: [], link: [], decision: [], action: [], note: [] };
    for (const i of m.items) by[i.kind].push(i);
    return by;
  }, [m.items]);
  const present = m.attendees.filter((a) => a.present);
  const nameOf = (id: unknown) => people.find((p) => p.id === Number(id))?.name ?? "";
  const elapsed = Math.max(0, Math.floor(((live ? now : ts(m.endedAt)) - ts(m.startedAt)) / 1000)) || 0;
  const jitsi = `https://${domain}/${encodeURIComponent(m.room)}#config.prejoinPageEnabled=false`
    + `&userInfo.displayName=${encodeURIComponent(JSON.stringify(me.name))}`;
  const current = items.agenda.find((a) => !a.meta.done);

  return (
    <div className={`v3-room v3-room-one${live ? " live" : " ended"}`}>
      {/* ── 머리 ─────────────────────────────────────────────── */}
      <header className="v3-room-head">
        <div className="v3-room-title">
          <Link href="/v3/room" className="v3-room-back">회의실</Link>
          <h1 className="v3-h1">{m.title}</h1>
          <span className="v3-room-meta">
            {live ? <><span className="v3-room-dot" aria-hidden="true" /> 진행 중</> : "끝난 회의"}
            {" · "}{m.startedBy} 엶 · {seoul(m.startedAt)}
          </span>
        </div>
        <b className="v3-room-clock" aria-label="회의 시간">{clock(elapsed)}</b>
        <div className="v3-room-ppl" aria-label="참석자">
          {m.attendees.map((a) => (
            <span key={a.id} className={`v3-room-p${a.present ? " on" : ""}`} title={`${a.name}${a.present ? " · 접속 중" : ""}`}>
              <Avatar name={a.name} />
            </span>
          ))}
          {live && <em>{present.length}명 접속</em>}
        </div>
        <div className="v3-room-acts">
          {live && <Button onClick={invite}>초대 링크 복사</Button>}
          {live && host && <Button onClick={end}>회의 끝내기</Button>}
          <Link className="v3-btn" href="/v3/room">나가기</Link>
        </div>
      </header>

      {note && <p className="v3-room-note" role="status">{note}</p>}

      {live ? (
        <div className="v3-room-grid">
          {/* ── 영상 ─────────────────────────────────────────── */}
          <section className="v3-room-stage" aria-label="영상 · 화면 공유">
            {video ? (
              <iframe title="영상 회의" src={jitsi}
                      allow="camera; microphone; display-capture; fullscreen; clipboard-write; autoplay" />
            ) : (
              <div className="v3-room-off">
                <b>영상은 아직 꺼져 있습니다</b>
                <p>켜면 카메라 · 마이크 허락을 묻습니다. 화면 공유는 영상 안의 공유 버튼으로 합니다.</p>
                <Button primary onClick={() => setVideo(true)}>영상 켜기</Button>
              </div>
            )}
            <footer className="v3-room-cap">
              <span>영상 · 화면 공유: Jitsi ({domain})</span>
              {video && <button type="button" className="v3-room-link" onClick={() => setVideo(false)}>영상 끄기</button>}
              <a className="v3-room-link" href={`https://${domain}/${encodeURIComponent(m.room)}`} target="_blank" rel="noreferrer">새 창에서 열기</a>
            </footer>
          </section>

          {/* ── 안건 · 링크 · 결정 · 할 일 ──────────────────────── */}
          <section className="v3-room-side v3-card" aria-label="회의 내용">
            {current && <p className="v3-room-now"><span>지금 안건</span> {current.body}</p>}
            <div className="v3-room-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind}
                        className={tab === t.kind ? "on" : ""} onClick={() => { setTab(t.kind); setText(""); }}>
                  {t.label} <span>{items[t.kind].length}</span>
                </button>
              ))}
            </div>

            <form className="v3-room-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input ref={input} className="v3-room-in" value={text} maxLength={1000}
                     aria-label={TABS.find((t) => t.kind === tab)!.hint}
                     placeholder={TABS.find((t) => t.kind === tab)!.hint} onChange={(e) => setText(e.target.value)} />
              {tab === "action" && (
                <div className="v3-room-addx">
                  <select aria-label="담당" value={who} onChange={(e) => setWho(Number(e.target.value))}>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="date" aria-label="기한" value={due} onChange={(e) => setDue(e.target.value)} />
                </div>
              )}
            </form>

            <ul className="v3-room-items">
              {items[tab].length === 0 && <li className="v3-room-quiet">아직 없습니다.</li>}
              {items[tab].map((i) => {
                const mine = i.createdById === me.id;
                const x = (host || mine) && (
                  <button type="button" className="v3-room-x" aria-label="내리기" title="내리기"
                          onClick={() => act(i.id, "remove")}>×</button>
                );
                if (i.kind === "agenda") return (
                  <li key={i.id} className={`v3-room-it agenda${i.meta.done ? " done" : ""}${current?.id === i.id ? " cur" : ""}`}>
                    <button type="button" className="v3-room-ck" aria-pressed={!!i.meta.done}
                            aria-label={i.meta.done ? "끝냄 되돌리기" : "끝냄"} onClick={() => act(i.id, "toggle")} />
                    <span className="v3-room-b">{i.body}<em>{i.createdBy}</em></span>{x}
                  </li>
                );
                if (i.kind === "link") return (
                  <li key={i.id} className="v3-room-it link">
                    <a className="v3-room-b" href={i.url ?? "#"} target="_blank" rel="noreferrer">
                      {i.body}<em>{i.createdBy} 공유 · {seoul(i.createdAt).slice(6)}</em>
                    </a>{x}
                  </li>
                );
                if (i.kind === "decision") {
                  const v = votesOf(i), decided = !!i.meta.decidedAt, voted = v.includes(me.id);
                  return (
                    <li key={i.id} className={`v3-room-it decision${decided ? " decided" : ""}`}>
                      <span className="v3-room-b">
                        <i className="v3-room-st">{decided ? "확정" : "제안"}</i>{i.body}
                        <em>{i.createdBy} · 찬성 {v.length}/{Math.max(present.length, v.length)}</em>
                      </span>
                      {!decided && (
                        <span className="v3-room-ia">
                          <button type="button" className={`v3-room-vote${voted ? " on" : ""}`} aria-pressed={voted}
                                  onClick={() => act(i.id, "vote")}>찬성</button>
                          {host && <button type="button" className="v3-room-vote" onClick={() => act(i.id, "decide")}>확정</button>}
                        </span>
                      )}
                      {x}
                    </li>
                  );
                }
                const taskId = Number(i.meta.taskId) || 0;
                return (
                  <li key={i.id} className="v3-room-it action">
                    <span className="v3-room-b">
                      {i.body}
                      <em>{nameOf(i.meta.assigneeId) || i.createdBy}{typeof i.meta.due === "string" ? ` · ~${i.meta.due.slice(5)}` : ""}</em>
                    </span>
                    <span className="v3-room-ia">
                      {taskId
                        ? <Link className="v3-room-vote on" href={`/v3/tasks/${taskId}`}>업무 #{taskId}</Link>
                        : <button type="button" className="v3-room-vote" onClick={() => toTask(i)}>업무로 만들기</button>}
                    </span>
                    {x}
                  </li>
                );
              })}
            </ul>
            <p className="v3-room-foot">끝내면 안건 · 결정 · 할 일 · 링크가 회의록 한 장으로 정리되고, 참석자 각자의 내 기록에 한 줄씩 남습니다.</p>
          </section>
        </div>
      ) : (
        <MinutesView m={m} />
      )}
    </div>
  );
}

/** 끝난 회의 — 굳은 회의록. 고치는 길이 없다 */
function MinutesView({ m }: { m: Meeting }) {
  const n = (m.minutes ?? null) as Minutes | null;
  const [copied, setCopied] = useState("");
  if (!n) return <p className="v3-room-quiet">회의록이 없습니다.</p>;

  const copy = async () => {
    const L: string[] = [`# ${n.title}`, `${seoul(n.startedAt)} ~ ${seoul(n.endedAt).slice(6)} · 참석 ${n.attendees.join(", ")}`];
    if (n.agenda.length) L.push("", "## 안건", ...n.agenda.map((a) => `- [${a.done ? "x" : " "}] ${a.body}`));
    if (n.decisions.length) L.push("", "## 결정", ...n.decisions.map((d) => `- ${d.body} (찬성 ${d.votes})`));
    if (n.openProposals.length) L.push("", "## 정하지 못한 것", ...n.openProposals.map((p) => `- ${p}`));
    if (n.actions.length) L.push("", "## 할 일", ...n.actions.map((a) => `- ${a.body}${a.taskId ? ` (업무 #${a.taskId})` : ""}`));
    if (n.links.length) L.push("", "## 링크", ...n.links.map((l) => `- ${l.body} ${l.url ?? ""}`.trim()));
    try { await navigator.clipboard.writeText(L.join("\n")); setCopied("회의록을 복사했습니다"); }
    catch { setCopied("복사하지 못했습니다"); }
  };

  const block = (title: string, rows: React.ReactNode[], empty: string) => (
    <section className="v3-room-mb">
      <h2>{title}</h2>
      {rows.length ? <ul>{rows}</ul> : <p className="v3-room-quiet">{empty}</p>}
    </section>
  );

  return (
    <div className="v3-room-min v3-card">
      <div className="v3-room-mh">
        <span>참석 {n.attendees.length}명 — {n.attendees.join(" · ")}</span>
        <Button onClick={copy}>회의록 복사</Button>
        {copied && <em role="status">{copied}</em>}
      </div>
      <div className="v3-room-mg">
        {block("결정", n.decisions.map((d, k) => <li key={k} className="dec">{d.body}<em>찬성 {d.votes}</em></li>), "확정한 결정이 없습니다.")}
        {block("할 일", n.actions.map((a, k) => (
          <li key={k}>{a.body}{a.taskId ? <Link className="v3-room-tk" href={`/v3/tasks/${a.taskId}`}>업무 #{a.taskId}</Link> : <em>업무 안 만듦</em>}</li>
        )), "할 일이 없습니다.")}
        {block("안건", n.agenda.map((a, k) => <li key={k} className={a.done ? "done" : ""}>{a.body}</li>), "안건이 없었습니다.")}
        {block("링크", n.links.map((l, k) => (
          <li key={k}>{l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.body}</a> : l.body}</li>
        )), "공유한 링크가 없습니다.")}
        {n.openProposals.length > 0 && block("정하지 못한 것", n.openProposals.map((p, k) => <li key={k}>{p}</li>), "")}
      </div>
    </div>
  );
}
