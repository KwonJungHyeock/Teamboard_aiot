"use client";

// 월간 보고 — 업무일지를 재료로 쓰고 · 내고 · 확인받는다 (DESIGN.md 5.5 · monthly-report.dc.html).
//   내 보고: 단계(쓰는 중 → 제출 → 확인) · 저장됨 · ✦ AI 초안(흘려 쓴다) · 본문 · 팀장에게 내기 / 제출 완료 도장 / 회수하고 고치기
//            재료: 이 달 기록 + 끝낸 업무를 카테고리로 묶고, 누르면 본문의 `## 카테고리` 아래에 한 줄 들어간다
//   팀원 보고(팀장): 팀원 카드(제출 · 쓰는 중 · 미작성 · 확인함) + 읽기 전용 문서 + 확인
// 쓰는 중인 글은 나만 본다 — 팀원 보고에는 낸 글만 보인다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ago, catColor, initial, md } from "@/lib/ed/core";
import { useToast } from "../ui";

interface Report {
  id: number; actorId: number; name: string; month: string; body: string; status: "draft" | "submitted";
  aiAt: string | null; submittedAt: string | null; leadReadAt: string | null; leadReadBy: string | null; leadComment: string | null; updatedAt: string;
}
interface TeamRow { actorId: number; name: string; state: "none" | "writing" | "submitted" | "read"; report: Report | null }
interface Src { key: string; day: string; text: string; cat: string; color: string; done: boolean }

const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
const iso = (s: string) => s.replace(" ", "T").replace(/\+00(:00)?$/, "Z");
const kstMd = (s: string) => md(new Date(Date.parse(iso(s)) + 9 * 3600 * 1000).toISOString().slice(0, 10));
const lineOf = (s: Src) => `- ${s.text}${s.done ? " (완료)" : ""}`;

export default function ReportView({ lead, initMonth, initTab }: { lead: boolean; initMonth: string; initTab: "mine" | "team" }) {
  const [month, setMonth] = useState(initMonth);
  const [tab, setTab] = useState<"mine" | "team">(initTab);
  const [mine, setMine] = useState<Report | null>(null);
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [src, setSrc] = useState<Src[]>([]);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState(false);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [tsel, setTsel] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [intro, setIntro] = useState(true);
  const [, setTick] = useState(0);
  const [toast, show] = useToast();
  const ta = useRef<HTMLTextAreaElement>(null);
  const saver = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<string | null>(null);

  const loadMine = useCallback(async (m: string) => {
    const r = await fetch(`/api/monthly?m=${m}`, { cache: "no-store" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { show(d.error ?? "불러오지 못했습니다"); return; }
    setMine(d.mine); setBody(d.mine?.body ?? ""); setSavedAt(d.mine ? Date.parse(iso(d.mine.updatedAt)) : null); setLoaded(true);
  }, [show]);
  const loadSrc = useCallback(async (m: string) => {
    const r = await fetch(`/api/ed/log?month=${m}`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json();
    const cats = new Map<number, { name: string; color: string }>((d.categories ?? []).map((c: { id: number; name: string; color: string }) => [c.id, c]));
    const color = (n: string, own?: string) => (catColor(n) !== "var(--sub)" ? catColor(n) : own ?? "var(--sub)");
    const out: Src[] = [];
    for (const e of d.entries ?? []) {
      const c = e.categoryId ? cats.get(e.categoryId) : undefined;
      const name = c?.name ?? "기타";
      if (!e.body) continue;
      out.push({ key: `w${e.id}`, day: e.loggedOn, text: e.body, cat: name, color: color(name, c?.color), done: false });
    }
    for (const t of d.done ?? []) out.push({ key: `t${t.id}`, day: t.loggedOn, text: t.title, cat: t.areaName, color: color(t.areaName), done: true });
    setSrc(out);
  }, []);
  const loadTeam = useCallback(async (m: string) => {
    if (!lead) return;
    const r = await fetch(`/api/ed/report/team?m=${m}`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json();
    setTeam(d.team ?? []);
  }, [lead]);

  useEffect(() => {
    setLoaded(false); setFlash({});
    void loadMine(month); void loadSrc(month); void loadTeam(month);
  }, [month, loadMine, loadSrc, loadTeam]);
  useEffect(() => { const t = setTimeout(() => setIntro(false), 1400); return () => clearTimeout(t); }, []);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    // 팀원 고르기 — 처음엔 확인 기다리는 사람부터
    if (tsel !== null && team.some((m) => m.actorId === tsel)) return;
    setTsel((team.find((m) => m.state === "submitted") ?? team[0])?.actorId ?? null);
  }, [team, tsel]);

  const status: "writing" | "submitted" | "acked" = mine?.status === "submitted" ? (mine.leadReadAt ? "acked" : "submitted") : "writing";
  const locked = status !== "writing" || typing;

  const flush = useCallback(async () => {
    clearTimeout(saver.current);
    const b = pending.current;
    if (b === null) return;
    pending.current = null;
    const r = await fetch("/api/monthly", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, body: b }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { show(d.error ?? "저장하지 못했습니다"); return; }
    setMine(d.mine); setSavedAt(Date.now());
  }, [month, show]);
  const autosave = (b: string) => {
    pending.current = b;
    clearTimeout(saver.current);
    saver.current = setTimeout(() => void flush(), 700);
  };
  useEffect(() => () => { void flush(); }, [flush]);
  const edit = (b: string) => { setBody(b); autosave(b); };

  /** 재료 넣기 — `## 카테고리` 아래에 한 줄. 없으면 머리를 만든다 */
  const insert = (items: Src[]) => {
    if (locked) return;
    const fresh = items.filter((s) => !body.includes(lineOf(s)));
    if (!fresh.length) return;
    let b = body;
    for (const s of fresh) {
      const head = `## ${s.cat}`;
      if (!b.includes(head)) b = `${b.trim() ? b.replace(/\s*$/, "\n\n") : ""}${head}\n${lineOf(s)}`;
      else {
        const i = b.indexOf(head) + head.length;
        const nx = b.indexOf("\n## ", i);
        const at = nx < 0 ? b.replace(/\s*$/, "").length : nx;
        b = `${b.slice(0, at).replace(/\s*$/, "")}\n${lineOf(s)}${b.slice(at)}`;
      }
    }
    setFlash((f) => { const n = { ...f }; fresh.forEach((x) => { n[x.key] = (n[x.key] ?? 0) + 1; }); return n; });
    edit(b);
  };

  const ai = async () => {
    if (locked) return;
    if (body.trim() && !window.confirm("지금 본문을 AI 초안으로 바꿀까요?")) return;
    await flush();
    setTyping(true); setBody("");
    let acc = "";
    try {
      const r = await fetch("/api/ed/report/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) });
      if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? "AI 초안을 만들지 못했습니다"); }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const cut = acc.indexOf("\u0000");
        setBody(cut < 0 ? acc : acc.slice(0, cut).trimEnd());
        if (ta.current) ta.current.scrollTop = ta.current.scrollHeight;
      }
      const cut = acc.indexOf("\u0000");
      if (cut >= 0) show(acc.slice(cut + 1) || "AI 초안을 만들지 못했습니다");
    } catch (e) {
      show(e instanceof Error ? e.message : "AI 초안을 만들지 못했습니다");
    } finally {
      setTyping(false);
      await loadMine(month);
    }
  };

  const act = async (action: "submit" | "withdraw") => {
    await flush();
    const r = await fetch("/api/monthly", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, action }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { show(d.error ?? "처리하지 못했습니다"); return; }
    setMine(d.mine); setBody(d.mine.body);
    window.dispatchEvent(new Event("ed:changed"));
  };
  const ack = async (rep: Report) => {
    const r = await fetch(`/api/monthly/${rep.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comment.trim() ? { comment: comment.trim() } : {}) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { show(d.error ?? "확인하지 못했습니다"); return; }
    setComment("");
    await loadTeam(month);
    window.dispatchEvent(new Event("ed:changed"));
  };

  const lines = body.split("\n").filter((l) => l.trim().startsWith("- ")).length;
  const stepIdx = { writing: 0, submitted: 1, acked: 2 }[status];
  const groups = useMemo(() => {
    const m = new Map<string, Src[]>();
    for (const s of src) m.set(s.cat, [...(m.get(s.cat) ?? []), s]);
    return Array.from(m.entries()).map(([cat, xs]) => ({ cat, color: xs[0].color, xs: xs.sort((a, b) => b.day.localeCompare(a.day)) }))
      .sort((a, b) => b.xs.length - a.xs.length);
  }, [src]);
  const used = src.filter((s) => body.includes(lineOf(s))).length;
  const waiting = team.filter((m) => m.state === "submitted").length;
  const [y, mo] = month.split("-").map(Number);
  const sel = team.find((m) => m.actorId === tsel) ?? null;
  const TAG: Record<TeamRow["state"], [string, string]> = { read: ["확인함", "green"], submitted: ["제출", "accent"], writing: ["쓰는 중", "amber"], none: ["미작성", "none"] };
  const subOf = (m: TeamRow) => (m.report?.submittedAt && (m.state === "submitted" || m.state === "read") ? `${kstMd(m.report.submittedAt)} 제출` : m.state === "writing" ? "작성 중" : "아직 없음");

  return (
    <div className="rep-page">
      <div className="rep-head">
        <div className="l">
          <Link href="/v3/log" className="rep-crumb">업무일지 /</Link>
          <h1 className="ed-h1">월간 보고</h1>
          <div className="log-mon rep-mon">
            <button type="button" onClick={() => { void flush(); setMonth(shiftMonth(month, -1)); }} aria-label="이전 달">‹</button>
            <span className="tn">{y}년 {mo}월</span>
            <button type="button" onClick={() => { void flush(); setMonth(shiftMonth(month, 1)); }} aria-label="다음 달">›</button>
          </div>
        </div>
        {lead && (
          <div className="ed-seg rep-tabs">
            <button type="button" className={tab === "mine" ? "on" : undefined} onClick={() => setTab("mine")}>내 보고</button>
            <button type="button" className={tab === "team" ? "on" : undefined} onClick={() => setTab("team")}>팀원 보고{waiting > 0 && <small className="tn">{waiting}</small>}</button>
          </div>
        )}
      </div>

      {tab === "mine" ? (
        <div className="rep-grid">
          <section className="rep-doc">
            <div className="rep-bar">
              <div className="rep-steps">
                {["쓰는 중", "제출", "확인"].map((label, i) => (
                  <div key={label} className="st">
                    <span className={`d${stepIdx > i ? " ok" : stepIdx === i ? " cur" : ""}`}>{stepIdx > i ? "✓" : i + 1}</span>
                    <span className={`l${stepIdx === i ? " cur" : ""}`}>{label}</span>
                    {i < 2 && <span className="bar"><i style={{ transform: `scaleX(${stepIdx > i ? 1 : 0})` }} /></span>}
                  </div>
                ))}
              </div>
              <span className="saved tn">{savedAt && mine ? `저장됨 · ${ago(new Date(savedAt).toISOString())}` : ""}</span>
              <button type="button" className={`rep-ai${typing ? " on" : ""}`} onClick={() => void ai()} disabled={status !== "writing" || typing}
                      style={{ opacity: status === "writing" ? 1 : 0.4 }}>✦ {typing ? "쓰는 중…" : "AI 초안"}</button>
            </div>
            <div className="rep-body">
              <textarea ref={ta} value={body} readOnly={locked} onChange={(e) => edit(e.target.value)} aria-label="보고 본문"
                        placeholder={loaded ? "✦ AI 초안 또는 오른쪽 재료를 눌러 시작" : ""} />
              {status !== "writing" && <span className="rep-stamp" key={mine?.submittedAt ?? "s"}>제출 완료</span>}
            </div>
            {mine?.leadComment && status === "acked" && (
              <div className="rep-cmt"><b>{mine.leadReadBy ?? "팀장"}</b>{mine.leadComment}</div>
            )}
            <div className="rep-foot">
              <span className="tn">{lines}줄 · {body.length}자</span>
              {status !== "writing"
                ? <button type="button" className="ed-btn rep-un" onClick={() => void act("withdraw")}>회수하고 고치기</button>
                : <button type="button" className={`rep-go${lines ? "" : " off"}`} disabled={!lines || typing} onClick={() => void act("submit")}>팀장에게 내기</button>}
            </div>
          </section>

          <aside className="rep-src">
            <div className="rep-sh"><b>재료</b><small className="tn">{used}/{src.length}</small></div>
            <div className="rep-sl ed-scroll">
              {groups.length === 0 ? <div className="ed-empty" style={{ padding: "8px 10px" }}>이 달 기록 없음</div> : groups.map((g, gi) => (
                <div key={g.cat} className={intro ? "rep-g in" : "rep-g"} style={intro ? { animationDelay: `${(0.15 + gi * 0.05).toFixed(2)}s` } : undefined}>
                  <div className="rep-gh"><i style={{ background: g.color }} /><b>{g.cat}</b><small>{g.xs.length}</small>
                    <button type="button" onClick={() => insert(g.xs)} disabled={locked}>모두 넣기</button></div>
                  {g.xs.map((s) => {
                    const u = body.includes(lineOf(s));
                    return (
                      <button key={s.key} type="button" className={`rep-it${u ? " u" : ""}`} onClick={() => insert([s])} disabled={locked}
                              style={flash[s.key] ? { animation: `used${flash[s.key] % 2 ? "A" : "B"} .9s ease-out` } : undefined}>
                        <span className="dt tn">{md(s.day)}</span>
                        <span className="tx"><span>{s.text}</span>{s.done && <em>완료</em>}</span>
                        <span className="mk">{u ? "✓" : "+"}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <div className="rep-team">
          <section className="rep-people ed-scroll">
            {team.length === 0 ? <div className="ed-empty">팀원 없음</div> : team.map((m, i) => {
              const [tag, tone] = TAG[m.state];
              return (
                <button key={m.actorId} type="button" className={`rep-p${m.actorId === tsel ? " on" : ""}`} onClick={() => setTsel(m.actorId)}
                        style={intro ? { animation: `rowIn .4s var(--ease) ${(0.1 + i * 0.05).toFixed(2)}s backwards` } : undefined}>
                  <span className="av">{initial(m.name)}</span>
                  <div className="nm"><b>{m.name}</b><small>{subOf(m)}</small></div>
                  <span className={`tg ${tone}`}>{tag}</span>
                </button>
              );
            })}
          </section>
          <section className="rep-doc rep-read">
            {sel && (
              <>
                <div className="rep-bar">
                  <b className="rn">{sel.name}</b><small className="rs">{sel.state === "writing" ? "작성 중" : sel.report?.submittedAt && sel.state !== "none" ? `${kstMd(sel.report.submittedAt)} 제출` : ""}</small>
                  {sel.state === "submitted" && sel.report && (
                    <div className="rep-ack">
                      <input className="ed-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="한 줄 코멘트" aria-label="코멘트" maxLength={500} />
                      <button type="button" className="ed-btn pri" onClick={() => void ack(sel.report!)}>확인</button>
                    </div>
                  )}
                  {sel.state === "read" && <span className="rep-ok">확인함 ✓</span>}
                </div>
                <div className={`rep-txt${sel.report?.body ? "" : " none"}`}>
                  {sel.state === "submitted" || sel.state === "read" ? sel.report?.body : sel.state === "writing" ? "아직 내지 않았어요" : "아직 작성하지 않았어요"}
                </div>
                {sel.state === "read" && sel.report?.leadComment && <div className="rep-cmt"><b>{sel.report.leadReadBy ?? "팀장"}</b>{sel.report.leadComment}</div>}
              </>
            )}
          </section>
        </div>
      )}
      {toast}
    </div>
  );
}
