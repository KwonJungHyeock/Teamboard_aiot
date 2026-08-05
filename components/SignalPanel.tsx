"use client";

// 시그널 패널 (Phase 6 → MD-P-2026-022 §A2) — /signals가 쓰는 목록 컴포넌트.
// 구성: ①필터 칩(전체/결정/확인/메모/리스크) ②항목 = **38px 목록 행**(카드 아님).
// 행 규격은 app/design.css 의 .dl / .dl-row 한 벌을 그대로 쓴다 — 새 컴포넌트를 만들지 않는다.
// 정렬(리스크 고정 → 정체 → 최신)은 서버가 결정하고 여기서는 타입 필터만 건다.
// 에이전트 작성물은 좌측 바이올렛 보더(.sig-card.ag) + 봇 태그(.atag)로 구분.
import { useMemo, useState } from "react";
import type { SignalType } from "@/lib/types";

export interface SignalPanelItem {
  id: number;
  kind: "signal" | "draft";
  type: string;
  title: string;
  meta: string;
  badge: "stale" | "wait" | "priv" | "decided" | "tome" | null;
  badgeLabel: string | null;
  agent: boolean;
  stalled: boolean;
  /** 정체·리스크 → 코랄 강조 (좌측 액센트) */
  emphasis?: boolean;
  /** 우측 인라인 빠른 액션 (한 건). 없으면 열기만. */
  quick?: { label: string; kind: "decide" | "confirm" | "resolve" } | null;
}

const SIGNAL_TABS: { key: "all" | SignalType; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "decision", label: "결정" },
  { key: "review", label: "확인" },
  { key: "memo", label: "메모" },
  { key: "risk", label: "리스크" },
];

const TYPE_LABEL: Record<string, string> = {
  decision: "결정",
  review: "확인",
  memo: "메모",
  risk: "리스크",
};

export default function SignalPanel({
  items,
  stalledCount,
  onSelect,
  selectedId,
  onQuickAct,
  busyId,
}: {
  items: SignalPanelItem[];
  stalledCount: number;
  /** 지정 시 kind='signal' 행이 클릭 가능해진다 (스레드 열기) */
  onSelect?: (id: number) => void;
  selectedId?: number | null;
  /** 우측 인라인 빠른 액션 실행 (확정·확인·처리) */
  onQuickAct?: (id: number, kind: string) => void;
  /** 처리 중인 항목 id (버튼 비활성) */
  busyId?: number | null;
}) {
  const [tab, setTab] = useState<"all" | SignalType>("all");

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    for (const t of SIGNAL_TABS.slice(1)) {
      counts[t.key] = items.filter((s) => s.type === t.key).length;
    }
    return counts;
  }, [items]);

  const visible = tab === "all" ? items : items.filter((s) => s.type === tab);

  return (
    <div className="sig-wrap">
      {/* ① 상단 요약 카드 (= 필터). 칩 클릭 시 해당 유형만. */}
      <div className="tile sig-sum" role="group" aria-label="논의·결정 요약·필터">
        {SIGNAL_TABS.map((t) => (
          <button
            key={t.key}
            className={`sig-chip c-${t.key}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            <span className="sig-chip-l">{t.label}</span>
            <span className="sig-chip-n num">{tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
        {stalledCount > 0 && (
          <span className="sig-stall" aria-label={`정체 ${stalledCount}`}>
            <i />정체 {stalledCount}
          </span>
        )}
      </div>

      {/* ② 항목 = 목록 행 (§C 38px). 카드 금지 */}
      {visible.length === 0 ? (
        <div className="dl">
          <div className="dl-empty">
            <p>{tab === "all" ? "아직 논의·결정이 없어요" : "이 유형의 논의·결정이 없어요"}</p>
            <p className="dl-empty-sub">결정이 필요한 논의·확인 요청·리스크·메모를 남기면 팀 전체가 흐름을 추적할 수 있어요.</p>
          </div>
        </div>
      ) : (
        <div className="dl">
          <div className="dl-head">
            <span className="dl-c" style={{ flex: "0 0 46px" }}>유형</span>
            <span className="dl-c">제목</span>
            <span className="dl-c" style={{ flex: "0 0 190px" }}>정보</span>
            <span className="dl-c" style={{ flex: "0 0 128px" }}>상태 · 처리</span>
          </div>
          {visible.map((s) => {
            const clickable = onSelect && s.kind === "signal";
            const open = clickable ? () => onSelect!(s.id) : undefined;
            const busy = busyId === s.id;
            return (
              <div
                className={[
                  "dl-row",
                  clickable ? "click" : "",
                  s.emphasis ? "risk" : "",                                  // 좌측 코랄 액센트
                  selectedId === s.id && s.kind === "signal" ? "on" : "",
                ].filter(Boolean).join(" ")}
                key={`${s.kind}-${s.id}`}
                onClick={open}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter") open!(); } : undefined}
              >
                <span className="dl-c" style={{ flex: "0 0 46px" }}>
                  <span className={`sig-ty ${s.type}`}>{TYPE_LABEL[s.type] ?? s.type}</span>
                </span>
                <span className="dl-c">
                  {s.agent && <span className="atag"><span className="mo" />에이전트</span>}
                  {s.title}
                </span>
                <span className="dl-c sig-meta" style={{ flex: "0 0 190px" }}>{s.meta}</span>
                <span className="dl-c sig-right" style={{ flex: "0 0 128px" }}>
                  {s.badge && <span className={`sig-tag ${s.badge}`}>{s.badgeLabel}</span>}
                  {s.quick && onQuickAct && (
                    <button
                      className="sig-act primary"
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); onQuickAct(s.id, s.quick!.kind); }}
                    >
                      {s.quick.label}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
