"use client";

// 시그널 패널 (Phase 6 → 홈 Bento 톤 확산) — /signals가 쓰는 목록 컴포넌트.
// 구성: ①상단 요약 카드(=필터, 전체/결정/확인/메모/리스크 칩) ②항목 = 통일 카드.
// 정렬(리스크 고정 → 정체 → 최신)은 서버가 결정하고 여기서는 타입 필터만 건다.
// 에이전트 작성물은 좌측 바이올렛 보더(.sig-card.ag) + 봇 태그(.atag)로 구분.
import { useMemo, useState } from "react";
import type { SignalType } from "@/lib/types";
import EmptyState from "./EmptyState";

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

      {/* ② 항목 = 통일 카드 */}
      {visible.length === 0 ? (
        <section className="tile sig-empty" aria-label="논의·결정 없음">
          <EmptyState
            compact
            title={tab === "all" ? "아직 논의·결정이 없어요" : "이 유형의 논의·결정이 없어요"}
            hint="결정이 필요한 논의·확인 요청·리스크·메모를 남기면 팀 전체가 흐름을 추적할 수 있어요."
          />
        </section>
      ) : (
        <div className="sig-cards">
          {visible.map((s) => {
            const clickable = onSelect && s.kind === "signal";
            const open = clickable ? () => onSelect!(s.id) : undefined;
            const busy = busyId === s.id;
            return (
              <article
                className={[
                  "tile sig-card",
                  s.emphasis ? "em" : "",
                  s.agent ? "ag" : "",
                  clickable ? "clickable" : "",
                  selectedId === s.id && s.kind === "signal" ? "selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={`${s.kind}-${s.id}`}
                onClick={open}
                role={clickable ? "button" : undefined}
              >
                <span className={`sig-ty ${s.type}`}>{TYPE_LABEL[s.type] ?? s.type}</span>
                <div className="sig-card-main">
                  <div className="sig-card-h">
                    {s.agent && (
                      <span className="atag">
                        <span className="mo" />
                        에이전트
                      </span>
                    )}
                    <span className="sig-card-title">{s.title}</span>
                  </div>
                  <div className="sig-card-meta">{s.meta}</div>
                </div>
                <div className="sig-card-right">
                  {s.badge && <span className={`sig-tag ${s.badge}`}>{s.badgeLabel}</span>}
                  <div className="sig-card-acts">
                    {s.quick && onQuickAct && (
                      <button
                        className="sig-act primary"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickAct(s.id, s.quick!.kind);
                        }}
                      >
                        {s.quick.label}
                      </button>
                    )}
                    {clickable && (
                      <button
                        className="sig-act"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect!(s.id);
                        }}
                      >
                        열기 <span aria-hidden="true">↗</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
