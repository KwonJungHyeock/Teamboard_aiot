"use client";

// 시그널 화면 (Phase 6) — SignalPanel(홈과 공유) + SignalThread + 새 시그널.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
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

/** /api/signals 응답을 패널 아이템으로 — 홈(lib/home.ts)과 같은 표기 규칙 */
export function toPanelItem(s: ApiSignal): SignalPanelItem {
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
  return {
    id: s.id,
    kind: "signal",
    type: s.type,
    title: s.title,
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

function NewSignalForm({
  actors,
  onDone,
}: {
  actors: { id: number; name: string }[];
  onDone: () => void;
}) {
  const [type, setType] = useState("memo");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetActorId, setTargetActorId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim()) return;
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
    <div className="tnew">
      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="memo">메모 (비공개)</option>
        <option value="decision">결정 필요</option>
        <option value="review">확인 요청</option>
        <option value="risk">리스크</option>
      </select>
      {type === "review" && (
        <select value={targetActorId} onChange={(e) => setTargetActorId(Number(e.target.value))}>
          <option value={0}>확인 대상 선택</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <input
        placeholder="제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        placeholder="내용 (선택)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ minWidth: 240 }}
      />
      <button className="lk" onClick={submit} disabled={busy || !title.trim()}>
        추가
      </button>
      {error && <span className="gerr">{error}</span>}
    </div>
  );
}

export default function SignalsView({ user }: { user: SessionUser }) {
  const [signals, setSignals] = useState<ApiSignal[]>([]);
  const [actors, setActors] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showClosed, setShowClosed] = useState(false);

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

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>시그널</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">SIGNALS</div>
            <h1>시그널</h1>
            <p>결정 · 확인 요청 · 메모 · 리스크. 리스크는 상단 고정, 정체는 임계값 기준입니다.</p>
          </div>
          <div className="seg" role="group" aria-label="종결 보기">
            <button aria-pressed={!showClosed} onClick={() => setShowClosed(false)}>
              열림
            </button>
            <button aria-pressed={showClosed} onClick={() => setShowClosed(true)}>
              종결
            </button>
          </div>
        </div>

        {loading && <p className="gempty">불러오는 중...</p>}
        {error && <p className="gerr">{error}</p>}
        {!loading && (
          <SignalPanel
            items={signals.map(toPanelItem)}
            stalledCount={stalledCount}
            onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
            selectedId={selectedId}
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

        <NewSignalForm actors={actors} onDone={load} />
      </div>
    </div>
  );
}
