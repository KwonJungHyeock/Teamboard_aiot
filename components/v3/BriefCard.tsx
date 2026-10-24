"use client";

// 관제 → AI 주간 브리핑. 지난주(기본) · 이번 주(지금까지). 서버가 센 사실을 AI 가 문장으로 옮긴 것.
// 무엇을 보냈는지 카드에 적는다 — 「내 기록」은 안 보낸다는 것을 읽는 사람이 알아야 한다.
import { useState } from "react";
import { Button } from "./parts";

interface Brief {
  weekStart: string; weekEnd: string; text: string; generatedAt: string; by: string; demo: boolean;
  facts: { done: number; created: number; lateTotal: number; meetings: number; decisions: number };
}
type Week = "last" | "this";

/** 마크다운 조금(## 제목 · - 글머리)만 그린다 — 다른 것은 글자 그대로 */
function Text({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => { if (list.length) { out.push(<ul key={`u${k}`}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>); list = []; } };
  text.split("\n").forEach((raw, k) => {
    const l = raw.trim();
    if (!l) return;
    if (l.startsWith("#")) { flush(k); out.push(<h3 key={k}>{l.replace(/^#+\s*/, "")}</h3>); }
    else if (/^[-*·]\s/.test(l)) list.push(l.replace(/^[-*·]\s+/, "").replace(/\*\*/g, ""));
    else { flush(k); out.push(<p key={k}>{l.replace(/\*\*/g, "")}</p>); }
  });
  flush(9999);
  return <div className="v3-brief-t">{out}</div>;
}

const seoul = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");

export default function BriefCard({ initial, canLead }: { initial: Brief | null; canLead: boolean }) {
  const [week, setWeek] = useState<Week>("last");
  const [byWeek, setByWeek] = useState<Record<Week, Brief | null | undefined>>({ last: initial, this: undefined });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const b = byWeek[week];

  const show = async (w: Week) => {
    setWeek(w); setErr("");
    if (byWeek[w] !== undefined) return;
    const r = await fetch(`/api/brief?week=${w}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) { const d = await r.json(); setByWeek((m) => ({ ...m, [w]: d.brief })); }
  };
  const make = async () => {
    setBusy(true); setErr("");
    const r = await fetch("/api/brief", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setErr((r && (await r.json().catch(() => null))?.error) || "만들지 못했습니다."); return; }
    const d = await r.json();
    setByWeek((m) => ({ ...m, [week]: d.brief }));
  };

  return (
    <section className="v3-brief" aria-label="AI 주간 브리핑">
      <header className="v3-brief-h">
        <h2>AI 주간 브리핑</h2>
        <span className="v3-brief-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={week === "last"} onClick={() => void show("last")}>지난주</button>
          <button type="button" role="tab" aria-selected={week === "this"} onClick={() => void show("this")}>이번 주</button>
        </span>
        {b && <em>{b.weekStart.slice(5).replace("-", ".")} ~ {b.weekEnd.slice(5).replace("-", ".")} · {seoul(b.generatedAt)} {b.by}{b.demo ? " · 데모" : ""}</em>}
        {(b === null || (b && canLead)) && (
          <Button onClick={() => void make()} disabled={busy}>{busy ? "만드는 중…" : b ? "다시 만들기" : "브리핑 만들기"}</Button>
        )}
      </header>
      {b === undefined && <p className="v3-brief-q">불러오는 중…</p>}
      {b === null && !busy && <p className="v3-brief-q">{week === "last" ? "지난주" : "이번 주"} 브리핑이 아직 없습니다. 누르면 AI 가 한 번 정리합니다(수십 초).</p>}
      {b && (
        <>
          <ul className="v3-brief-n">
            <li><b>{b.facts.done}</b>끝낸 업무</li><li><b>{b.facts.created}</b>새 업무</li>
            <li className={b.facts.lateTotal ? "late" : ""}><b>{b.facts.lateTotal}</b>기한 지남</li>
            <li><b>{b.facts.meetings}</b>회의</li><li><b>{b.facts.decisions}</b>결정</li>
          </ul>
          <Text text={b.text} />
        </>
      )}
      {err && <p className="v3-brief-q err" role="alert">{err}</p>}
      <p className="v3-brief-f">팀 공개 업무 · 회의 · 목표만 AI 에 보냅니다. 「내 기록」 · 개인 업무는 보내지 않습니다. 숫자는 서버가 셉니다.</p>
    </section>
  );
}
