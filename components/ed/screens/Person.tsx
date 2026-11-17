"use client";

// 팀원 상세 · 개인 성과 카드 (2026-11 모니터링) — 숫자는 `/api/ed/people/[id]` 가 센다.
//   머리: 이름 · 직급 · [월 | 분기] · ‹ 기간 › · 엑셀 · (팀장) 사람 바꾸기
//   지표: 열린 업무(지남) · 완료 · 기한 준수율 · 처리 기간 · 목표 기여 · 업무일지 쓴 날
//   주별 완료 막대 · 열린 업무 · 완료 · 업무일지 · 월간 보고 · 최근 활동. 줄을 누르면 업무 드로어.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { STATUS_LABEL, type Status } from "@/lib/ed/core";
import { downloadXlsx } from "@/lib/ed/xlsx";
import type { PersonCard } from "@/lib/person-card";
import { useMeta } from "../data";
import { Seg } from "../ui";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const md = (iso: string) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;
const shift = (at: string, kind: "month" | "quarter", d: number) => {
  const y = +at.slice(0, 4), m = +at.slice(5, 7) - 1 + d * (kind === "quarter" ? 3 : 1);
  const t = new Date(Date.UTC(y, m, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
const ROLE: Record<string, string> = { admin: "관리자", lead: "팀장", member: "팀원" };
const MSTATE = (s: { status: string; readAt: string | null }) => (s.readAt ? "확인함" : s.status === "submitted" ? "제출" : "쓰는 중");

export default function Person({ personId, meId }: { personId: number; meId: number }) {
  const router = useRouter();
  const meta = useMeta();
  const [kind, setKind] = useState<"month" | "quarter">("month");
  const [at, setAt] = useState<string | null>(null);
  const [card, setCard] = useState<PersonCard | null>(null);
  const [canLead, setCanLead] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const q = new URLSearchParams({ period: kind, ...(at ? { at } : {}) });
    const r = await fetch(`/api/ed/people/${personId}?${q}`, { cache: "no-store" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setErr(d.error ?? "불러오지 못했습니다"); return; }
    setErr(""); setCard(d.card); setCanLead(!!d.canLead);
    if (!at) setAt(d.card.today.slice(0, 7));
  }, [personId, kind, at]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const f = () => void load(); window.addEventListener("ed:changed", f); return () => window.removeEventListener("ed:changed", f); }, [load]);

  if (err) return <div className="ed-page"><div className="ed-empty">{err}</div></div>;
  if (!card || !at) return <div className="ed-page"><div className="ed-empty">불러오는 중</div></div>;
  const k = card.kpi, n = card.now;
  const onRate = pct(k.onTime, k.onTime + k.late);
  const logRate = pct(k.logDays, k.workDays);
  const wmax = Math.max(1, ...card.weeks.map((w) => w.n));
  const live = at === card.today.slice(0, 7) || (kind === "quarter" && card.period.start <= card.today && card.today <= card.period.end);
  const open = (id: number) => router.push(`?task=${id}`, { scroll: false });

  const exportXlsx = () => downloadXlsx(`성과_${card.person.name}_${card.period.label.replace(/\s/g, "")}`, [
    { name: "요약", widths: [22, 16], rows: [
      ["항목", "값"], ["이름", card.person.name], ["기간", card.period.label],
      ["열린 업무", n.open], ["지남", n.over], ["함께하는 업무", n.with],
      ["기간 완료", k.done], ["기한 안 완료", k.onTime], ["기한 넘김", k.late], ["기한 없이 완료", k.noDue],
      ["기한 준수율(%)", onRate ?? ""], ["처리 기간 중앙값(일)", k.cycleMedian ?? ""], ["목표에 걸린 완료", k.goalDone],
      ["업무일지 쓴 날", k.logDays], ["평일 수", k.workDays], ["기록률(%)", logRate ?? ""],
    ] },
    { name: "주별 완료", widths: [12, 10], rows: [["주(월요일)", "완료"], ...card.weeks.map((w) => [w.start, w.n])] },
    { name: "열린 업무", widths: [48, 10, 12, 14, 8], rows: [["업무", "상태", "기한", "카테고리", "지남"],
      ...card.open.map((t) => [t.title, STATUS_LABEL[t.status as Status] ?? t.status, t.due ?? "", t.area, t.over ? "지남" : ""])] },
    { name: "완료", widths: [48, 12, 12, 14, 10], rows: [["업무", "완료일", "기한", "카테고리", "기한"],
      ...card.done.map((t) => [t.title, t.doneOn, t.due ?? "", t.area, t.due ? (t.late ? "넘김" : "안") : "없음"])] },
    { name: "업무일지", widths: [12, 14, 70], rows: [["날짜", "카테고리", "내용"], ...card.logs.map((l) => [l.loggedOn, l.cat ?? "", l.body])] },
  ]);

  const Tile = ({ label, v, sub, tone }: { label: string; v: string; sub?: string; tone?: "red" | "green" | "amber" }) => (
    <div className={`pc-tile${tone ? ` ${tone}` : ""}`}><span>{label}</span><b className="tn">{v}</b>{sub && <small>{sub}</small>}</div>
  );

  return (
    <div className="ed-page pc">
      <div className="pc-head">
        <div className="pc-who">
          <span className="pc-av">{card.person.name.slice(0, 1)}</span>
          <div>
            <div className="pc-crumb">{canLead ? <Link href="/v3/control">팀원별 현황</Link> : "내 성과"} /</div>
            <h1 className="ed-h1">{card.person.name}<small>{ROLE[card.person.role ?? ""] ?? ""}</small></h1>
          </div>
          {canLead && meta && (
            <select className="ed-input pc-pick" value={personId} aria-label="사람 바꾸기" onChange={(e) => router.push(`/v3/people/${e.target.value}`)}>
              {meta.people.map((p) => <option key={p.id} value={p.id}>{p.id === meId ? `나 · ${p.name}` : p.name}</option>)}
            </select>
          )}
        </div>
        <div className="pc-ctl">
          <Seg value={kind} onChange={(v) => setKind(v)} options={[{ v: "month", label: "월" }, { v: "quarter", label: "분기" }]} />
          <div className="pc-mv">
            <button type="button" onClick={() => setAt(shift(at, kind, -1))} aria-label="이전 기간">‹</button>
            <span>{card.period.label}</span>
            <button type="button" onClick={() => setAt(shift(at, kind, 1))} aria-label="다음 기간" disabled={live}>›</button>
          </div>
          <button type="button" className="ed-btn sm" onClick={exportXlsx}>엑셀</button>
        </div>
      </div>

      <div className="pc-tiles">
        <Tile label="열린 업무" v={String(n.open)} sub={n.over ? `지남 ${n.over} · 함께 ${n.with}` : `함께 ${n.with}`} tone={n.over ? "red" : undefined} />
        <Tile label="완료" v={String(k.done)} sub={card.period.label} />
        <Tile label="기한 준수율" v={onRate === null ? "—" : `${onRate}%`} sub={`기한 안 ${k.onTime} · 넘김 ${k.late}${k.noDue ? ` · 기한 없음 ${k.noDue}` : ""}`}
              tone={onRate === null ? undefined : onRate >= 80 ? "green" : onRate < 60 ? "red" : "amber"} />
        <Tile label="처리 기간" v={k.cycleMedian === null ? "—" : `${k.cycleMedian}일`} sub="시작 → 완료 중앙값" />
        <Tile label="목표 기여" v={String(k.goalDone)} sub="목표에 걸린 완료" />
        <Tile label="업무일지" v={`${k.logDays}/${k.workDays}일`} sub={k.lastLog ? `마지막 ${md(k.lastLog)}` : "기록 없음"}
              tone={logRate === null ? undefined : logRate >= 80 ? "green" : logRate < 50 ? "red" : "amber"} />
      </div>

      <div className="pc-weeks" aria-label="주별 완료">
        {card.weeks.map((w) => (
          <div key={w.start} className="pc-wk" title={`${w.start} 주 · 완료 ${w.n}`}>
            <i style={{ height: `${Math.max(4, (w.n / wmax) * 100)}%`, opacity: w.n ? 1 : 0.25 }} /><b className="tn">{w.n}</b><span>{w.label}</span>
          </div>
        ))}
      </div>

      <div className="pc-cols">
        <section className="pc-sec">
          <h2>열린 업무 <span className="tn">{card.open.length}</span></h2>
          {card.open.length ? card.open.map((t) => (
            <button key={t.id} type="button" className={`pc-row${t.over ? " over" : ""}`} onClick={() => open(t.id)}>
              <span className={`pc-st s-${t.status}`}>{STATUS_LABEL[t.status as Status] ?? t.status}</span>
              <span className="tt">{t.title}</span>
              <em>{t.due ? (t.over ? `${md(t.due)} 지남` : md(t.due)) : "기한 없음"}</em>
            </button>
          )) : <div className="pc-empty">열린 업무 없음</div>}
          <h2>완료 <span className="tn">{card.done.length}</span></h2>
          {card.done.length ? card.done.map((t) => (
            <button key={t.id} type="button" className="pc-row done" onClick={() => open(t.id)}>
              <span className="pc-st s-done">완료</span><span className="tt">{t.title}</span>
              <em className={t.late ? "late" : undefined}>{md(t.doneOn)}{t.due ? (t.late ? " · 기한 넘김" : "") : " · 기한 없음"}</em>
            </button>
          )) : <div className="pc-empty">이 기간 완료 없음</div>}
        </section>
        <section className="pc-sec">
          <h2>업무일지 <span className="tn">{card.logs.length}</span>
            {canLead && personId !== meId && <Link className="pc-more" href={`/v3/log?owner=${personId}`}>전체 보기 →</Link>}</h2>
          {card.logs.length ? card.logs.slice(0, 14).map((l) => (
            <div key={l.id} className="pc-log">
              <em className="tn">{md(l.loggedOn)}</em>
              <span>{l.body}{l.taskId && <button type="button" className="pc-tk" onClick={() => open(l.taskId!)}>업무</button>}</span>
              {l.cat && <small>{l.cat}</small>}
            </div>
          )) : <div className="pc-empty">이 기간 기록 없음</div>}
          <h2>월간 보고</h2>
          {card.monthly.length ? card.monthly.map((m) => (
            <div key={m.month} className="pc-log">
              <em className="tn">{Number(m.month.slice(5))}월</em>
              <span>{MSTATE(m)}{m.comment ? ` — ${m.comment}` : ""}</span>
            </div>
          )) : <div className="pc-empty">아직 쓴 보고 없음</div>}
          <h2>최근 활동</h2>
          {card.activity.length ? card.activity.slice(0, 10).map((a, i) => (
            <div key={i} className="pc-act"><span>{a.message}</span><em className="tn">{md(new Date(Date.parse(a.at.replace(" ", "T").replace(/\+00$/, "Z")) + 9 * 3600e3).toISOString().slice(0, 10))}</em></div>
          )) : <div className="pc-empty">활동 없음</div>}
        </section>
      </div>
    </div>
  );
}
