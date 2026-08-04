"use client";

// 전역 우측 패널 (MD-P-2026-006 §B) — 논의 스레드 · 멤버 프로필 · 결정 상세를 한 컴포넌트가 연다.
// 업무 상세는 편집기 규모가 커 TaskDetailPanel이 렌더하지만, 같은 셸(.gpanel*)·같은 규칙을 쓴다.
// 규칙: 폭 420px · Esc 닫기 · 좌측 목록 계속 조작(배경 차단 없음) · 스택 깊이 1 · URL 반영.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import SignalThread from "./SignalThread";
import { DecisionCard, decTime, type Decision } from "./decision-ui";
import { SIDE_PANEL_EVENT, currentPanel, closePanel, openPanel, type PanelRef } from "@/lib/side-panel";
import { openTaskPanel } from "@/lib/task-panel";
import { SIGNAL_CHANGED_EVENT } from "@/lib/collab-events";

const TITLE: Record<string, string> = { signal: "논의", member: "멤버", decision: "결정", task: "업무" };

/** 패널 셸 — 제목줄 + 닫기. 모든 종류가 이 껍데기를 공유한다. */
export function PanelShell({
  kind, title, onClose, children,
}: { kind: string; title?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="gpanel" role="complementary" aria-label={`${TITLE[kind] ?? kind} 패널`}>
      <div className="gpanel-h">
        <b>{title ?? TITLE[kind] ?? kind}</b>
        <button className="gpanel-x" onClick={onClose} aria-label="닫기 (Esc)" title="닫기 (Esc)">✕</button>
      </div>
      {/* .hv — 논의 스레드가 쓰는 워크스페이스 스코프 규칙을 패널 안에서도 적용 */}
      <div className="gpanel-b hv">{children}</div>
    </aside>
  );
}

export default function SidePanel({ user }: { user: SessionUser }) {
  const [ref, setRef] = useState<PanelRef | null>(null);

  // 열림 상태 소스: URL + 이벤트 + 뒤로가기 (셋이 항상 같은 값을 가리킨다)
  useEffect(() => {
    const sync = () => setRef(currentPanel());
    sync();
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setRef(d && typeof d === "object" && d.kind ? (d as PanelRef) : null);
    };
    window.addEventListener(SIDE_PANEL_EVENT, onEvent);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(SIDE_PANEL_EVENT, onEvent);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  // 업무는 TaskDetailPanel이 그린다 — 여기서는 나머지 3종만.
  const active = ref && ref.kind !== "task" ? ref : null;

  // 열려 있는 동안 본문 폭을 줄여 좌측 목록이 가려지지 않게 한다(배경 차단 없음).
  useEffect(() => {
    document.body.classList.toggle("gpanel-open", !!ref);
    return () => document.body.classList.remove("gpanel-open");
  }, [ref]);

  const close = useCallback(() => closePanel(), []);

  if (!active) return null;
  return (
    <PanelShell kind={active.kind} onClose={close}>
      {active.kind === "signal" && (
        <SignalThread
          key={active.id}
          signalId={active.id}
          user={user}
          onChanged={() => window.dispatchEvent(new CustomEvent(SIGNAL_CHANGED_EVENT))}
        />
      )}
      {active.kind === "member" && <MemberBody key={active.id} id={active.id} />}
      {active.kind === "decision" && <DecisionBody key={active.id} id={active.id} />}
    </PanelShell>
  );
}

// ── 멤버 프로필 ──
interface MemberData {
  member: { id: number; name: string; isAgent: boolean; isActive: boolean; role: string | null; assistantName: string | null };
  openCount: number;
  doneThisWeek: number;
  tasks: { id: number; title: string; status: string; progress: number; dueDate: string | null; projectName: string | null }[];
  decisions: { id: number; title: string; decidedAt: string }[];
}

function MemberBody({ id }: { id: number }) {
  const [d, setD] = useState<MemberData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/members/${id}`).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) { setErr(j.error ?? "불러올 수 없습니다."); return; }
      setD(j);
    }).catch(() => alive && setErr("불러올 수 없습니다."));
    return () => { alive = false; };
  }, [id]);

  if (err) return <p className="gerr">{err}</p>;
  if (!d) return <p className="gempty">불러오는 중...</p>;
  const role = d.member.isAgent ? "에이전트" : d.member.role === "lead" ? "팀장" : d.member.role === "viewer" ? "뷰어" : "팀원";
  return (
    <div className="spm">
      <div className="spm-h">
        <span className="spm-av">{d.member.name.slice(0, 1)}</span>
        <div>
          <b>{d.member.name}</b>
          <span className="spm-role">{role}{d.member.isActive ? "" : " · 비활성"}</span>
        </div>
      </div>
      <div className="spm-stats">
        <div><span className="num">{d.openCount}</span><em>진행 중</em></div>
        <div><span className="num">{d.doneThisWeek}</span><em>이번 주 완료</em></div>
      </div>
      <div className="gpanel-sec">
        <h4>담당 업무</h4>
        {d.tasks.length === 0 ? <p className="gpanel-none">진행 중인 업무가 없어요.</p> : (
          <ul className="gpanel-list">
            {d.tasks.map((t) => (
              <li key={t.id}>
                <button onClick={() => openTaskPanel(t.id)}>{t.title}</button>
                <span className="num">{t.progress}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {d.decisions.length > 0 && (
        <div className="gpanel-sec">
          <h4>최근 확정한 결정</h4>
          <ul className="gpanel-list">
            {d.decisions.map((x) => (
              <li key={x.id}>
                <button onClick={() => openPanel("decision", x.id)}>{x.title}</button>
                <span className="num">{decTime(x.decidedAt).slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── 결정 상세 ──
function DecisionBody({ id }: { id: number }) {
  const [d, setD] = useState<{ decision: Decision; tasks: { id: number; title: string; progress: number }[]; supersedes: { id: number; title: string }[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/decisions/${id}`).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) { setErr(j.error ?? "불러올 수 없습니다."); return; }
      setD(j);
    }).catch(() => alive && setErr("불러올 수 없습니다."));
    return () => { alive = false; };
  }, [id]);

  if (err) return <p className="gerr">{err}</p>;
  if (!d) return <p className="gempty">불러오는 중...</p>;
  return (
    <div className="spd">
      <DecisionCard decision={d.decision} />
      {d.supersedes.length > 0 && (
        <div className="gpanel-sec">
          <h4>번복한 결정</h4>
          <ul className="gpanel-list">
            {d.supersedes.map((s) => (
              <li key={s.id}><button onClick={() => openPanel("decision", s.id)}>{s.title}</button></li>
            ))}
          </ul>
        </div>
      )}
      {d.tasks.length > 0 && (
        <div className="gpanel-sec">
          <h4>연결 업무</h4>
          <ul className="gpanel-list">
            {d.tasks.map((t) => (
              <li key={t.id}>
                <button onClick={() => openTaskPanel(t.id)}>{t.title}</button>
                <span className="num">{t.progress}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="gpanel-sec">
        <h4>원본 논의</h4>
        <ul className="gpanel-list">
          <li>
            <button onClick={() => openPanel("signal", d.decision.discussionId)}>
              {d.decision.discussionTitle ?? `논의 #${d.decision.discussionId}`}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
