"use client";

// 관제 — 팀 목표 · 데이터 · 사람 · 위험 신호 (2026-10 관제 패널).
//
// 값은 전부 서버 페이지가 `lib/control.ts` 로 세어 넘긴다. 이 부품은 그리고,
// 1분마다 다시 받아 오고(`router.refresh`), 팀장에게 「목표 세우기」를 연다.
//
// ── 막힌 데를 같이 본다 ────────────────────────────────────────
// 모두 같은 화면이다. 그래서 문구는 사람을 탓하지 않고 **일의 상태**를 말한다
// (「조서연 늦음」이 아니라 「기한 3일 지남 · 무료 게임 체험 게이트 · 조서연」).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { V3_BASE } from "@/lib/v3/routes";
import { EMPTY_LIST_QUERY, serializeListQuery } from "@/lib/v3/list-query";
import { Card, Button, StatTile } from "./parts";

type GoalStatus = "ontrack" | "risk" | "wait" | "done";
interface Goal {
  id: number; title: string; level: "year" | "quarter" | "month";
  periodStart: string; periodEnd: string; progress: number | null; elapsed: number; status: GoalStatus | null;
}
interface Person {
  id: number; name: string; role: string | null; nowTitle: string | null; nowId: number | null;
  open: number; late: number; quiet: number; week: number; heavy: boolean; lastSeen: string | null;
}
interface Signal { kind: "late" | "quiet" | "heavy"; taskId: number | null; title: string; who: string | null; days: number }
export interface ControlProps {
  today: string;
  kpi: { doing: number; doneToday: number; late: number; quiet: number; open: number };
  flow: { day: string; done: number; made: number }[];
  goals: Goal[];
  people: Person[];
  signals: Signal[];
  quietDays: number;
  canLead: boolean;
  team: string;
}

/** 타일을 누르면 **같은 조건의 업무 목록**으로 — 주소는 목록이 읽는 글자로 만든다 */
const doingHref = `${V3_BASE}/tasks?${serializeListQuery({ ...EMPTY_LIST_QUERY, status: new Set(["doing"]) })}`;
const lateHref = `${V3_BASE}/tasks?${serializeListQuery({ ...EMPTY_LIST_QUERY, due: "late" })}`;

const LEVEL = { year: "연간", quarter: "분기", month: "월" } as const;
const STATUS: Record<GoalStatus, { t: string; cls: string }> = {
  ontrack: { t: "순조", cls: "ok" }, risk: { t: "주의", cls: "risk" }, wait: { t: "시작 전", cls: "wait" }, done: { t: "달성", cls: "ok" },
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "기록 없음";
  const t = Date.parse(iso.replace(" ", "T").replace(/\+(\d\d)$/, "+$1:00"));
  if (Number.isNaN(t)) return "—";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
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

export default function ControlView(p: ControlProps) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  // 1분마다 새로 받는다. 탭이 숨어 있으면 쉰다 — 안 보는 화면이 DB 를 두드리지 않게.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const pull = setInterval(() => {
      if (document.visibilityState === "visible") { router.refresh(); setLoadedAt(Date.now()); }
    }, 60000);
    return () => { clearInterval(tick); clearInterval(pull); };
  }, [router]);

  /* ── 목표 세우기 ─────────────────────────────────────────────── */
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
      ? "세웠습니다 — 위 목표 후보가 여럿이라 목표 화면에서 하나 골라 주세요"
      : "세웠습니다 — 위 목표 밑으로 자동 연결됐습니다");
    router.refresh(); setLoadedAt(Date.now());
  };

  const tiers = (["year", "quarter", "month"] as const).map((lv) => ({ lv, goals: p.goals.filter((g) => g.level === lv) }));

  /* ── 2주 흐름 ─────────────────────────────────────────────────── */
  const chart = useMemo(() => {
    const W = 640, H = 140, n = Math.max(1, p.flow.length - 1);
    const max = Math.max(4, ...p.flow.map((f) => Math.max(f.done, f.made)));
    const pt = (v: number, i: number) => `${Math.round((i * W) / n)},${Math.round(H - 8 - (v / max) * (H - 24))}`;
    const doneSum = p.flow.reduce((a, f) => a + f.done, 0);
    const madeSum = p.flow.reduce((a, f) => a + f.made, 0);
    return {
      W, H, max,
      done: p.flow.map((f, i) => pt(f.done, i)).join(" "),
      made: p.flow.map((f, i) => pt(f.made, i)).join(" "),
      avg: p.flow.length ? doneSum / p.flow.length : 0,
      pace: p.flow.length ? (doneSum - madeSum) / p.flow.length : 0,
    };
  }, [p.flow]);

  const secs = Math.max(0, Math.round((now - loadedAt) / 1000));

  return (
    <div className="v3-ctl">
      <h1 className="v3-h1">관제</h1>
      <p className="v3-lede">
        {p.team} · 모두가 같은 화면을 봅니다 · <span className="v3-ctl-live"><i aria-hidden="true" />{secs < 5 ? "방금" : `${secs}초 전`} 갱신</span>
      </p>

      <div className="v3-stats">
        <StatTile n={p.kpi.doing} label="진행 중" sub={`안 끝난 일 ${p.kpi.open}`} href={doingHref} go />
        <StatTile n={p.kpi.doneToday} label="오늘 끝낸 일" sub={`2주 평균 ${chart.avg.toFixed(1)}`} />
        <StatTile n={p.kpi.late} label="기한 지남" late={p.kpi.late > 0} href={lateHref} go />
        <StatTile n={p.kpi.quiet} label={`${p.quietDays}일 넘게 소식 없음`} warn={p.kpi.quiet > 0} sub="진행·검토인데 손이 안 닿은 일" />
      </div>

      <div className="v3-ctl-grid">
        {/* ── 팀 목표 ─────────────────────────────────────────── */}
        <Card title="팀 목표" sub="진행률 / 지난 시간" className="v3-ctl-goals">
          {p.canLead ? (
            form ? (
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
                       placeholder="목표를 한 줄로 — 예: 가오픈 안정화, 장애 0건"
                       onChange={(e) => setTitle(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void save(); if (e.key === "Escape") setForm(false); }} />
                <p className="v3-ctl-why">위 기간의 목표 밑으로 자동 연결됩니다.</p>
                <div className="v3-ctl-acts">
                  <Button type="button" onClick={() => setForm(false)}>그만</Button>
                  <Button primary type="button" disabled={busy} onClick={() => void save()}>세우기</Button>
                </div>
              </div>
            ) : (
              <Button type="button" className="v3-ctl-add" onClick={() => { setForm(true); setMsg(""); }}>＋ 목표 세우기</Button>
            )
          ) : (
            <p className="v3-ctl-why">팀 목표는 팀장이 세웁니다. 내 목표는 목표 화면에서 세울 수 있어요.</p>
          )}
          {msg && <p className="v3-ctl-msg" role="status">{msg}</p>}

          {tiers.map(({ lv, goals }) => (
            <div key={lv} className="v3-ctl-tier">
              <span className="v3-ctl-kick">{LEVEL[lv]}</span>
              {goals.length === 0 ? <p className="v3-ctl-none">지금 기간의 {LEVEL[lv]} 목표가 없어요</p> : goals.map((g) => {
                const st = g.status ? STATUS[g.status] : null;
                const pct = g.progress ?? 0;
                return (
                  <Link key={g.id} href={`${V3_BASE}/goals/${g.id}`} className="v3-ctl-goal">
                    <span className="v3-ctl-gh">
                      <b>{g.title}</b>
                      {st && <em className={`v3-ctl-st ${st.cls}`}>{st.t}</em>}
                    </span>
                    <span className="v3-ctl-gbar" aria-hidden="true">
                      <span style={{ width: `${pct}%` }} />
                      <i style={{ left: `${g.elapsed}%` }} title="지난 시간" />
                    </span>
                    <span className="v3-ctl-gs">{g.progress === null ? "아직 셀 업무 없음" : `${pct}%`} · 기간 {g.elapsed}% 지남</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </Card>

        <div className="v3-ctl-mid">
          {/* ── 2주 흐름 ───────────────────────────────────────── */}
          <Card title="2주 흐름" sub={chart.pace >= 0
            ? `끝내는 속도가 하루 ${chart.pace.toFixed(1)}건 빠름`
            : `새로 생기는 속도가 하루 ${(-chart.pace).toFixed(1)}건 빠름`}>
            <div className="v3-ctl-legend">
              <span><i className="done" />끝낸 일</span><span><i className="made" />새로 생긴 일</span>
            </div>
            <svg viewBox={`0 0 ${chart.W} ${chart.H}`} width="100%" height={chart.H} role="img"
                 aria-label={`최근 14일 — 끝낸 일 ${p.flow.map((f) => f.done).join(",")} · 새로 생긴 일 ${p.flow.map((f) => f.made).join(",")}`}>
              <line x1="0" y1={chart.H - 8} x2={chart.W} y2={chart.H - 8} className="v3-ctl-axis" />
              <polyline points={chart.made} className="v3-ctl-made" />
              <polyline points={chart.done} className="v3-ctl-done" />
            </svg>
            <div className="v3-ctl-days">
              <span>{p.flow[0]?.day.slice(5)}</span><span>오늘 {p.today.slice(5)}</span>
            </div>
          </Card>

          {/* ── 사람별 지금 ──────────────────────────────────── */}
          <Card title="사람별 지금" sub="지금 하는 일 · 마지막 활동 · 맡은 일">
            {p.people.map((m) => (
              <div key={m.id} className={`v3-ctl-p${m.late || m.quiet || m.heavy ? " flag" : ""}`}>
                <span className="v3-ctl-av" aria-hidden="true">{m.name.slice(0, 1)}</span>
                <span className="v3-ctl-pn">
                  <b>{m.name}</b>
                  {m.nowId ? <Link href={`${V3_BASE}/tasks/${m.nowId}`}>{m.nowTitle}</Link> : <em>진행 중인 일 없음</em>}
                </span>
                <span className="v3-ctl-seen">마지막 활동<br /><b>{ago(m.lastSeen, now)}</b></span>
                <span className="v3-ctl-load">
                  <span>진행 <b>{m.open}</b> · 이번 주 {m.week}</span>
                  <span className="v3-bar"><span style={{ width: `${Math.min(100, (m.open / 8) * 100)}%` }} /></span>
                </span>
                <span className="v3-ctl-flags">
                  {m.late > 0 && <em className="late">지남 {m.late}</em>}
                  {m.quiet > 0 && <em className="warn">소식 없음 {m.quiet}</em>}
                  {m.heavy && <em className="warn">몰림</em>}
                </span>
              </div>
            ))}
          </Card>
        </div>

        {/* ── 위험 신호 ──────────────────────────────────────── */}
        <Card title="지금 볼 것" sub="매일 09:00 본인과 팀장에게 알림" className="v3-ctl-sig">
          {p.signals.length === 0 ? <p className="v3-ctl-none">막힌 데가 없어요 👍</p> : (
            <ol className="v3-ctl-list">
              {p.signals.map((s, i) => (
                <li key={`${s.kind}-${s.taskId ?? s.who}-${i}`} className={`v3-ctl-s ${s.kind}`}>
                  <span className="v3-ctl-tag">
                    {s.kind === "late" ? `기한 ${s.days}일 지남` : s.kind === "quiet" ? `${s.days}일째 소식 없음` : "몰림"}
                  </span>
                  {s.taskId ? <Link href={`${V3_BASE}/tasks/${s.taskId}`}>{s.title}</Link> : <span>{s.title}</span>}
                  {s.who && <span className="v3-ctl-who">{s.who}</span>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
