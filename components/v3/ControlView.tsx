"use client";

// 관제 v2 — 마감 안내판 · 상태 벽 · 지금 팀 · 방금 일어난 일 (2026-10, 시안 G-8 × 처음 정한 D 톤).
//
// 값은 전부 서버 페이지가 `lib/control.ts` 로 세어 넘긴다. 이 부품은 그리고,
// 1분마다 다시 받아 오고(`router.refresh`), 팀장에게 「목표 세우기」를 연다.
//
// ── 막힌 데를 같이 본다 ────────────────────────────────────────
// 모두 같은 화면이다. 문구는 사람을 탓하지 않고 **일의 상태**를 말한다.
//
// ── 움직임은 뜻이 있을 때만 ─────────────────────────────────────
//   · 안내판 글자판이 넘어간다 — **상태가 바뀐 줄만**(줄 열쇠에 상태를 넣어 그 칸만 새로 그린다)
//   · 상태 벽 타일 테두리가 숨쉰다 — 30분 안에 누가 손댄 일
//   · 사람 고리가 돌고 점이 맴돈다 — 30분 안에 활동한 사람
//   · 아래 띠가 흐른다 — 최근 끝냄 · 새로 · 손댐
// 움직임을 줄여 달라면 `app/v3.css` 의 한 자리가 전부 끈다.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { V3_BASE } from "@/lib/v3/routes";
import { EMPTY_LIST_QUERY, serializeListQuery } from "@/lib/v3/list-query";
import { Button } from "./parts";
import BriefCard from "./BriefCard";

type State = "ok" | "warn" | "late" | "review" | "done";
interface BoardRow { id: number; title: string; who: string | null; due: string; state: State; progress: number }
interface Tile { id: number; title: string; who: string | null; due: string | null; state: State; live: boolean; progress: number }
interface Group { id: number; title: string; progress: number | null; tiles: Tile[]; more: number }
interface Person {
  id: number; name: string; role: string | null; nowTitle: string | null; nowId: number | null;
  open: number; late: number; quiet: number; week: number; heavy: boolean; lastSeen: string | null; working: boolean;
  meeting: { id: number; title: string } | null;
  daily: { line: string | null; state: DailyState | null } | null;
}
type DailyState = "focus" | "out" | "off";
/** `lib/daily.ts` DAILY_STATES 와 같은 셋 — 그 파일은 `pg` 를 끌고 와서 부품이 import 하지 않는다 */
const STATE_LABEL: Record<DailyState, string> = { focus: "집중", out: "외근", off: "휴가" };
interface Feed { at: string; kind: "done" | "new" | "touch"; title: string; who: string | null; taskId: number }
export interface ControlProps {
  today: string;
  kpi: { doing: number; doneToday: number; late: number; quiet: number; open: number };
  board: BoardRow[];
  oldLate: number;
  wall: Group[];
  loose: number;
  people: Person[];
  feed: Feed[];
  quietDays: number;
  meId: number;
  canLead: boolean;
  /** 지난주 AI 브리핑(없으면 null) — `lib/brief.ts` */
  brief: React.ComponentProps<typeof BriefCard>["initial"];
  team: string;
  openDay: number | null;
  openDate: string | null;
}

const WORD: Record<State, string> = { ok: "정시", warn: "주의", late: "지연", review: "검토 중", done: "끝남" };
const FEED_WORD: Record<Feed["kind"], string> = { done: "끝냄", new: "새 업무", touch: "손댐" };
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const doingHref = `${V3_BASE}/tasks?${serializeListQuery({ ...EMPTY_LIST_QUERY, status: new Set(["doing"]) })}`;
const lateHref = `${V3_BASE}/tasks?${serializeListQuery({ ...EMPTY_LIST_QUERY, due: "late" })}`;

/** 「언제」를 읽히는 말로 — 3일 지남 · 오늘 · 내일 · 10.27 (화) */
function whenOf(due: string, today: string): string {
  const d = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (d < 0) return `${-d}일 지남`;
  if (d === 0) return "오늘";
  if (d === 1) return "내일";
  const w = WEEK[new Date(`${due}T00:00:00Z`).getUTCDay()];
  return `${due.slice(5).replace("-", ".")} (${w})`;
}
function leftOf(due: string | null, today: string, state: State): string {
  if (state === "done") return "끝";
  if (!due) return "기한 없음";
  const d = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (d < 0) return `${-d}일 지남`;
  if (d === 0) return "오늘";
  return `${d}일`;
}
function ago(iso: string | null, now: number): string {
  if (!iso) return "기록 없음";
  const t = Date.parse(iso.replace(" ", "T").replace(/\+(\d\d)$/, "+$1:00"));
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

/** 목표 세우기 — 기간의 첫날. 「이번」·「다음」 둘만 고른다 */
function startOf(level: "year" | "quarter" | "month", today: string, next: boolean): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  if (level === "year") return `${y + (next ? 1 : 0)}-01-01`;
  if (level === "quarter") {
    let q = Math.floor((m - 1) / 3) + (next ? 1 : 0), yy = y;
    if (q > 3) { q = 0; yy++; }
    return `${yy}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  }
  let mm = m + (next ? 1 : 0), yy = y;
  if (mm > 12) { mm = 1; yy++; }
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}
function periodName(level: "year" | "quarter" | "month", start: string): string {
  const y = start.slice(0, 4), m = Number(start.slice(5, 7));
  if (level === "year") return `${y}년`;
  if (level === "quarter") return `${y} ${Math.floor((m - 1) / 3) + 1}분기`;
  return `${y}년 ${m}월`;
}
const LEVEL = { year: "연간", quarter: "분기", month: "월" } as const;

export default function ControlView(p: ControlProps) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const me = p.people.find((m) => m.id === p.meId);

  // 1분마다 새로 받는다. 탭이 숨어 있으면 쉰다 — 안 보는 화면이 DB 를 두드리지 않게.
  useEffect(() => {
    const pull = setInterval(() => {
      if (document.visibilityState === "visible") { router.refresh(); setNow(Date.now()); }
    }, 60000);
    return () => clearInterval(pull);
  }, [router]);

  /* ── 목표 세우기 (팀장) ─────────────────────────────────────── */
  const [form, setForm] = useState(false);
  const [level, setLevel] = useState<"year" | "quarter" | "month">("month");
  const [next, setNext] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const start = startOf(level, p.today, next);
  const save = async () => {
    if (busy) return;
    if (!title.trim()) { setMsg("목표를 한 줄로 적어 주세요."); return; }
    setBusy(true); setMsg("");
    const r = await fetch("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "team", periodType: level, periodStart: start, title }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? `세우지 못했습니다 (${r.status})`); return; }
    setTitle(""); setForm(false);
    setMsg(d.parentCandidates?.length
      ? "세웠습니다. 위 목표 후보가 여럿이라 목표 화면에서 하나 골라 주세요."
      : "세웠습니다. 위 목표 밑으로 자동 연결됐습니다.");
    router.refresh();
  };

  const today = new Date(`${p.today}T00:00:00Z`);
  const dateLine = `${today.getUTCMonth() + 1}월 ${today.getUTCDate()}일 ${WEEK[today.getUTCDay()]}요일`;

  return (
    <div className="v3-ctl">
      <header className="v3-ctl-head">
        <div className="v3-ctl-title">
          <h1 className="v3-h1">관제</h1>
          <span className="v3-ctl-date">{dateLine} · {p.team} · 모두 같은 화면</span>
        </div>
        <Link className="v3-ctl-read late" href={lateHref}><b>{p.kpi.late}</b><span>기한 지남</span></Link>
        <div className="v3-ctl-read"><b>{p.kpi.quiet}</b><span>{p.quietDays}일째 소식 없음</span></div>
        <div className="v3-ctl-read"><b>{p.kpi.doneToday}</b><span>오늘 끝낸 일</span></div>
        <Link className="v3-ctl-read" href={doingHref}><b>{p.kpi.doing}</b><span>진행 중</span></Link>
        {p.openDay !== null && (
          <div className="v3-ctl-dday">
            <span>가오픈 {p.openDate}</span>
            <b>{p.openDay > 0 ? `D-${p.openDay}` : p.openDay === 0 ? "D-DAY" : `D+${-p.openDay}`}</b>
          </div>
        )}
      </header>
      <nav className="v3-ctl-more" aria-label="자세히 보기">
        <Link href={`${V3_BASE}/team`}>사람별 업무 자세히</Link>
        {p.canLead && <Link href={`${V3_BASE}/stats`}>집계</Link>}
        <Link href={V3_BASE}>내 하루(대시보드)</Link>
      </nav>

      <div className="v3-ctl-grid">
        {/* ── 마감 안내판 ─────────────────────────────────────── */}
        <section className="v3-ctl-board" aria-label="다가오는 마감">
          <div className="v3-ctl-bh">
            <h2>다가오는 마감</h2>
            <span>지난 2주부터 앞으로 2주</span>
          </div>
          <div className="v3-ctl-brow head" aria-hidden="true">
            <span>언제</span><span>업무</span><span>담당</span><span>상태</span>
          </div>
          {p.board.length === 0 ? (
            <p className="v3-ctl-bempty">2주 안에 마감인 업무가 없어요.</p>
          ) : p.board.map((b, i) => (
            <Link key={b.id} href={`${V3_BASE}/tasks/${b.id}`} className={`v3-ctl-brow s-${b.state}`}>
              <span className="v3-ctl-when">{whenOf(b.due, p.today)}</span>
              <span className="v3-ctl-bt">{b.title}</span>
              <span className="v3-ctl-who">{b.who ?? "담당 없음"}</span>
              <span className="v3-ctl-flapwrap">
                {/* 열쇠에 상태를 넣는다 — 상태가 바뀐 칸만 새로 그려져 글자판이 넘어간다 */}
                <span key={`${b.id}-${b.state}`} className="v3-ctl-flap" style={{ animationDelay: `${i * 0.05}s` }}>
                  {WORD[b.state]}
                </span>
              </span>
            </Link>
          ))}
          {p.oldLate > 0 && (
            <Link className="v3-ctl-old" href={lateHref}>2주 넘게 밀린 업무 {p.oldLate}건 · 목록에서 정리하기</Link>
          )}
        </section>

        {/* ── 상태 벽 ────────────────────────────────────────── */}
        <section className="v3-ctl-wall" aria-label="목표별 현황">
          <div className="v3-ctl-wh">
            <h2>목표별 현황</h2>
            <span>테두리가 숨쉬는 칸은 지금 손대는 중</span>
            {p.canLead && !form && (
              <Button type="button" className="v3-btn-s v3-ctl-add" onClick={() => { setForm(true); setMsg(""); }}>＋ 목표 세우기</Button>
            )}
          </div>
          {p.canLead && form && (
            <div className="v3-ctl-form">
              <div className="v3-ctl-seg" role="group" aria-label="기간">
                {(["year", "quarter", "month"] as const).map((lv) => (
                  <button key={lv} type="button" aria-pressed={level === lv} className={level === lv ? "on" : ""}
                          onClick={() => setLevel(lv)}>{LEVEL[lv]}</button>
                ))}
              </div>
              <div className="v3-ctl-seg" role="group" aria-label="이번 · 다음">
                {[false, true].map((nx) => (
                  <button key={String(nx)} type="button" aria-pressed={next === nx} className={next === nx ? "on" : ""}
                          onClick={() => setNext(nx)}>{periodName(level, startOf(level, p.today, nx))}</button>
                ))}
              </div>
              <input className="v3-ctl-in" autoFocus value={title} maxLength={200} aria-label="목표"
                     placeholder="목표를 한 줄로. 예: 가오픈 안정화, 장애 0건"
                     onChange={(e) => setTitle(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void save(); if (e.key === "Escape") setForm(false); }} />
              <div className="v3-ctl-acts">
                <span className="v3-ctl-why">위 기간의 목표 밑으로 자동 연결됩니다.</span>
                <Button type="button" className="v3-btn-s" onClick={() => setForm(false)}>그만</Button>
                <Button primary type="button" className="v3-btn-s" disabled={busy} onClick={() => void save()}>세우기</Button>
              </div>
            </div>
          )}
          {msg && <p className="v3-ctl-msg" role="status">{msg}</p>}

          {p.wall.length === 0 ? (
            <p className="v3-ctl-none">지금 분기의 팀 목표가 없어요. {p.canLead ? "목표를 세우면 여기 묶여 보입니다." : "팀장이 세우면 여기 묶여 보입니다."}</p>
          ) : p.wall.map((g) => (
            <div key={g.id} className="v3-ctl-group">
              <div className="v3-ctl-gh">
                <Link href={`${V3_BASE}/goals/${g.id}`}><b>{g.title}</b></Link>
                <span className="v3-ctl-gp">{g.progress === null ? "—" : `${g.progress}%`}</span>
                <span className="v3-ctl-gbar" aria-hidden="true"><span style={{ width: `${g.progress ?? 0}%` }} /></span>
              </div>
              {g.tiles.length === 0 ? <p className="v3-ctl-none">걸린 업무가 없어요.</p> : (
                <div className="v3-ctl-tiles">
                  {g.tiles.map((t) => (
                    <Link key={t.id} href={`${V3_BASE}/tasks/${t.id}`}
                          className={`v3-ctl-tile s-${t.state}${t.live ? " live" : ""}`}
                          title={`${t.title} · ${t.who ?? "담당 없음"} · ${WORD[t.state]}`}>
                      <b>{t.title}</b>
                      <span><span>{t.who ?? "담당 없음"}</span><span>{leftOf(t.due, p.today, t.state)}</span></span>
                    </Link>
                  ))}
                  {g.more > 0 && <Link className="v3-ctl-tile more" href={`${V3_BASE}/goals/${g.id}`}>＋{g.more}건 더</Link>}
                </div>
              )}
            </div>
          ))}
          {p.loose > 0 && (
            <p className="v3-ctl-loose">목표에 안 걸린 진행 업무 {p.loose}건 · <Link href={`${V3_BASE}/tasks`}>업무 목록에서 보기</Link></p>
          )}
        </section>
      </div>

      {/* ── 지금 팀 ───────────────────────────────────────────── */}
      <MyDay key={`${me?.daily?.line ?? ""}|${me?.daily?.state ?? ""}`} daily={me?.daily ?? null} onSaved={() => router.refresh()} />
      <section className="v3-ctl-team" aria-label="지금 팀">
        {p.people.map((m) => (
          <div key={m.id} className={`v3-ctl-m${m.working || m.meeting ? " working" : ""}${m.heavy || m.late ? " flag" : ""}`}>
            <span className="v3-ctl-ring" aria-hidden="true">
              <span className="v3-ctl-orbit" />
              <span className="v3-ctl-av">{m.name.slice(0, 1)}</span>
            </span>
            <span className="v3-ctl-mn">
              <span>
                <b>{m.name}</b>
                {!m.meeting && m.daily?.state && <span className={`v3-ctl-st ${m.daily.state}`}>{STATE_LABEL[m.daily.state]}</span>}
                {" "}<em>{m.meeting ? "회의 중" : m.working ? `작업 중 · ${ago(m.lastSeen, now)} 활동` : ago(m.lastSeen, now)}</em>
              </span>
              {m.daily?.line && <q className="v3-ctl-say" title="오늘 할 일 — 본인이 아침에 적은 한 줄">{m.daily.line}</q>}
              {m.meeting && <Link className="v3-ctl-mt" href={`${V3_BASE}/room/${m.meeting.id}`}>회의실 · {m.meeting.title}</Link>}
              {m.nowId ? <Link href={`${V3_BASE}/tasks/${m.nowId}`}>{m.nowTitle}</Link> : <i>진행 중인 일 없음</i>}
              <small>진행 {m.open} · 이번 주 마감 {m.week}{m.late ? ` · 지남 ${m.late}` : ""}{m.heavy ? " · 몰림" : ""}</small>
            </span>
          </div>
        ))}
      </section>

      {/* ── AI 주간 브리핑 ─────────────────────────────────────── */}
      <BriefCard initial={p.brief} canLead={p.canLead} />

      {/* ── 방금 일어난 일 ───────────────────────────────────────── */}
      {p.feed.length > 0 && (
        <section className="v3-ctl-feed" aria-label="방금 일어난 일">
          <div className="v3-ctl-track">
            {[0, 1].map((k) => (
              <span key={k} className="v3-ctl-run" aria-hidden={k === 1 ? true : undefined}>
                {p.feed.map((f, i) => (
                  <span key={`${k}-${i}`} className={`v3-ctl-fi k-${f.kind}`}>
                    <time>{f.at}</time> <b>{FEED_WORD[f.kind]}</b> {f.title}{f.who ? ` · ${f.who}` : ""}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * 하루 한 줄 · 상태 (0039) — 내 것만 여기서 고친다. **팀이 본다**(「내 기록」과 다르다).
 * 엔터나 칸을 벗어나면 저장, 상태 칩은 누르면 바로. 다시 누르면 「보통」으로.
 */
function MyDay({ daily, onSaved }: { daily: { line: string | null; state: DailyState | null } | null; onSaved: () => void }) {
  const [line, setLine] = useState(daily?.line ?? "");
  const [state, setState] = useState<DailyState | null>(daily?.state ?? null);
  const [note, setNote] = useState("");
  const save = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/daily", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .catch(() => null);
    if (!r?.ok) { setNote((r && (await r.json().catch(() => null))?.error) || "저장하지 못했습니다."); return; }
    setNote("팀에 보입니다");
    onSaved();
  };
  const saveLine = () => { if (line.trim() !== (daily?.line ?? "")) save({ line }); };
  return (
    <form className="v3-ctl-myday" onSubmit={(e) => { e.preventDefault(); saveLine(); }}>
      <label className="v3-ctl-myday-l" htmlFor="v3-myday">오늘 할 일</label>
      <input id="v3-myday" className="v3-ctl-myday-in" value={line} maxLength={200}
             placeholder="한 줄 — 팀이 봅니다 · 엔터로 저장" onChange={(e) => setLine(e.target.value)} onBlur={saveLine} />
      <span className="v3-ctl-myday-st" role="group" aria-label="내 상태">
        {(Object.keys(STATE_LABEL) as DailyState[]).map((k) => (
          <button key={k} type="button" aria-pressed={state === k} className={`v3-ctl-st ${k}${state === k ? " on" : ""}`}
                  onClick={() => { const next = state === k ? null : k; setState(next); save({ state: next }); }}>
            {STATE_LABEL[k]}
          </button>
        ))}
      </span>
      {note && <em className="v3-ctl-myday-n" role="status">{note}</em>}
    </form>
  );
}
