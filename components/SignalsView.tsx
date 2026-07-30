"use client";

// 시그널 화면 (Phase 6) — SignalPanel(홈과 공유) + SignalThread + 새 시그널.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import { toast } from "@/lib/quick";
import SignalPanel, { type SignalPanelItem } from "./SignalPanel";
import SignalThread from "./SignalThread";

export interface ApiSignal {
  id: number;
  type: string;
  scope: string;
  title: string;
  body: string;
  status: string;
  taskId: number | null;
  targetActorId: number | null;
  targetName: string | null;
  authorId: number;
  authorName: string;
  agent: boolean;
  projectName: string | null;
  days: number;
  decidedDays: number | null;
  commentCount: number;
  huddledAt: string | null;
  stalled: boolean;
  decidedStale: boolean;
  toMe: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  decision: "결정",
  review: "확인 요청",
  memo: "메모",
  risk: "리스크",
};

/** /api/signals 응답을 패널 아이템으로 — 홈(lib/home.ts)과 같은 표기 규칙.
 *  user 지정 시 권한에 맞는 우측 인라인 빠른 액션(확정·확인·처리)을 파생한다. */
export function toPanelItem(s: ApiSignal, user?: SessionUser): SignalPanelItem {
  const active = s.status === "open" || s.status === "discussing";
  const badge = s.toMe
    ? "tome"
    : s.type === "risk" && active
      ? "stale"
      : s.decidedStale
        ? "decided"
        : s.stalled
          ? "stale"
          : s.scope === "private"
            ? "priv"
            : null;
  const badgeLabel = s.toMe
    ? "확인 요청"
    : s.type === "risk" && active
      ? "고정"
      : s.decidedStale
        ? "미실행"
        : s.stalled
          ? "정체"
          : s.scope === "private"
            ? "비공개"
            : null;
  // 정체·리스크 → 코랄 강조
  const emphasis = s.stalled || (s.type === "risk" && active);
  // 권한별 한 건짜리 빠른 액션 (스레드 생명주기와 동일한 규칙)
  let quick: SignalPanelItem["quick"] = null;
  if (user && active) {
    const isAuthor = s.authorId === user.id;
    const isLead = user.role === "lead";
    const isTarget = s.targetActorId === user.id;
    if (s.type === "decision" && (isAuthor || isLead)) quick = { label: "확정", kind: "decide" };
    else if (s.type === "review" && (isTarget || isLead)) quick = { label: "확인", kind: "confirm" };
    else if (s.type === "memo" || s.type === "risk") quick = { label: "처리", kind: "resolve" };
  }
  return {
    id: s.id,
    kind: "signal",
    type: s.type,
    title: s.title,
    emphasis,
    quick,
    meta: [
      TYPE_LABEL[s.type] ?? s.type,
      s.scope === "private" ? "비공개" : s.authorName,
      s.type === "review" && s.targetName ? `→ ${s.targetName}` : null,
      s.status === "decided"
        ? `결정 후 ${s.decidedDays ?? 0}일`
        : s.status === "discussing"
          ? `논의중 ${s.days}일`
          : `${s.days}일 경과`,
      s.commentCount > 0 ? `코멘트 ${s.commentCount}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    badge,
    badgeLabel,
    agent: s.agent,
    stalled: s.stalled,
  };
}

const SIG_TYPES = [
  ["memo", "메모 (비공개)"], ["decision", "결정 필요"], ["review", "확인 요청"], ["risk", "리스크"],
] as const;

function NewSignalForm({
  actors,
  onDone,
  onCancel,
  initialType = "memo",
}: {
  actors: { id: number; name: string }[];
  onDone: () => void;
  onCancel?: () => void;
  initialType?: string;
}) {
  const [type, setType] = useState(initialType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetActorId, setTargetActorId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    if (!title.trim()) { setError("제목을 입력하세요."); return; }
    if (type === "review" && !targetActorId) {
      setError("확인 요청은 대상을 지정해야 합니다.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        title,
        body,
        targetActorId: type === "review" ? targetActorId : undefined,
      }), // scope는 서버 규칙 (memo=비공개, 그 외 팀)
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "생성 실패");
      return;
    }
    setTitle("");
    setBody("");
    onDone();
  }

  return (
    <section className="sig-compose" aria-label="새 논의·결정">
      <div className="sig-compose-h">
        <b>새 논의·결정</b>
        {onCancel && <button className="sig-compose-x" onClick={onCancel} aria-label="닫기">✕</button>}
      </div>
      <div className="sig-compose-seg" role="group" aria-label="유형">
        {SIG_TYPES.map(([v, l]) => (
          <button key={v} aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>
        ))}
      </div>
      <input
        className="sig-compose-title"
        placeholder="제목 — 무엇을 논의·결정할까요?"
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />
      {type === "review" && (
        <select className="sig-compose-target" value={targetActorId} onChange={(e) => setTargetActorId(Number(e.target.value))}>
          <option value={0}>확인 대상 선택</option>
          {actors.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
        </select>
      )}
      <textarea
        className="sig-compose-body"
        rows={3}
        placeholder="내용 (선택, ==강조== 지원)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {error && <p className="sig-compose-err">{error}</p>}
      <div className="sig-compose-foot">
        <span className="sig-compose-note">{type === "memo" ? "비공개 메모로 저장됩니다." : "팀 전체에 공유됩니다."}</span>
        <span style={{ flex: 1 }} />
        {onCancel && <button className="btn-outline" onClick={onCancel}>취소</button>}
        <button className="btn-brand" onClick={submit} disabled={busy || !title.trim()}>{busy ? "추가 중…" : "추가"}</button>
      </div>
    </section>
  );
}

export default function SignalsView({ user }: { user: SessionUser }) {
  const [signals, setSignals] = useState<ApiSignal[]>([]);
  const [actors, setActors] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // "+ 새로 만들기 > 시그널/메모" 진입 시 작성 폼 유형 프리셋 (파트 4)
  const [composerType, setComposerType] = useState("memo");
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("type");
    if (q && ["memo", "decision", "review", "risk"].includes(q)) { setComposerType(q); setComposing(true); }
    // 알림에서 진입 — ?signal=id 로 해당 스레드 자동 열기
    const sid = Number(sp.get("signal"));
    if (Number.isInteger(sid) && sid > 0) setSelectedId(sid);
  }, []);

  const load = useCallback(async () => {
    try {
      const urls = showClosed
        ? ["/api/signals?status=resolved", "/api/signals?status=archived"]
        : ["/api/signals"]; // 기본 = open/discussing/decided (미종결)
      const results = await Promise.all(urls.map((u) => fetch(u).then((r) => r.json())));
      const merged = results.flatMap((d) => d.signals ?? []);
      if (results.some((d) => d.error)) throw new Error(results.find((d) => d.error)!.error);
      setSignals(merged);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [showClosed]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/meta/selectors")
      .then((r) => r.json())
      .then((d) => setActors(d.actors ?? []))
      .catch(() => {});
  }, []);

  const stalledCount = signals.filter((s) => s.stalled).length;

  // 우측 인라인 빠른 액션 — 스레드 생명주기와 동일한 API (PUT /api/signals/:id)
  const QUICK_BODY: Record<string, Record<string, unknown>> = {
    decide: { status: "decided" },
    confirm: { action: "confirmReview" },
    resolve: { status: "resolved" },
  };
  const QUICK_DONE: Record<string, string> = {
    decide: "결정으로 확정했어요",
    confirm: "확인 완료 처리했어요",
    resolve: "처리 완료했어요",
  };
  async function quickAct(id: number, kind: string) {
    const body = QUICK_BODY[kind];
    if (!body || busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/signals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast((await res.json()).error ?? "처리에 실패했어요", "err");
        return;
      }
      toast(QUICK_DONE[kind] ?? "처리했어요");
      await load();
    } catch {
      toast("네트워크 오류로 처리하지 못했어요", "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>논의·결정</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">SIGNALS</div>
            <h1>논의·결정</h1>
            <p>결정 · 확인 요청 · 메모 · 리스크. 리스크는 상단 고정, 정체는 임계값 기준입니다.</p>
          </div>
          <div className="head-r">
            <div className="seg" role="group" aria-label="종결 보기">
              <button aria-pressed={!showClosed} onClick={() => setShowClosed(false)}>
                열림
              </button>
              <button aria-pressed={showClosed} onClick={() => setShowClosed(true)}>
                종결
              </button>
            </div>
            <button className="newbtn sig-newbtn" onClick={() => setComposing((v) => !v)} aria-expanded={composing}>
              ＋ 새 논의·결정
            </button>
          </div>
        </div>

        {/* 새 논의·결정 — 상단 확대 폼(빠른 생성 톤). 버튼으로 열고 닫는다. */}
        {composing && (
          <NewSignalForm
            actors={actors}
            initialType={composerType}
            onDone={() => { setComposing(false); load(); }}
            onCancel={() => setComposing(false)}
          />
        )}

        {loading && <p className="gempty">불러오는 중...</p>}
        {error && <p className="gerr">{error}</p>}
        {!loading && (
          <SignalPanel
            items={signals.map((s) => toPanelItem(s, user))}
            stalledCount={stalledCount}
            onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
            selectedId={selectedId}
            onQuickAct={quickAct}
            busyId={busyId}
          />
        )}

        {selectedId && (
          <SignalThread
            signalId={selectedId}
            user={user}
            onChanged={load}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
