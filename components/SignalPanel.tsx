"use client";

// 시그널 패널 (Phase 6) — 홈과 /signals가 공유하는 목록 컴포넌트.
// 정렬(리스크 고정 → 정체 → 최신)은 서버가 결정하고 여기서는 타입 필터만 건다.
// 에이전트 작성물 4중 구분: 좌측 바이올렛 보더(.sig.ag) / 봇 태그(.atag) /
// 투명도 90%(CSS) / 승인 대기 배지(.bg.wait)
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
}

const SIGNAL_TABS: { key: "all" | SignalType; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "decision", label: "결정" },
  { key: "review", label: "확인" },
  { key: "memo", label: "메모" },
  { key: "risk", label: "리스크" },
];

export default function SignalPanel({
  items,
  stalledCount,
  onSelect,
  selectedId,
}: {
  items: SignalPanelItem[];
  stalledCount: number;
  /** 지정 시 kind='signal' 행이 클릭 가능해진다 (스레드 열기) */
  onSelect?: (id: number) => void;
  selectedId?: number | null;
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
    <section className="card" aria-label="시그널">
      <div className="ch">
        <h2>시그널</h2>
        <span className="sub">정체 {stalledCount}</span>
      </div>
      <div className="tabs" role="group" aria-label="시그널 필터">
        {SIGNAL_TABS.map((t) => (
          <button
            key={t.key}
            className="tab"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="n">{tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>
      <div>
        {visible.length === 0 && (
          <p style={{ color: "var(--lo)", fontSize: 12, padding: "8px 0" }}>
            표시할 시그널이 없습니다.
          </p>
        )}
        {visible.map((signal) => {
          const clickable = onSelect && signal.kind === "signal";
          return (
            <div
              className={[
                "sig",
                signal.agent ? "ag" : "",
                clickable ? "clickable" : "",
                selectedId === signal.id && signal.kind === "signal" ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${signal.kind}-${signal.id}`}
              onClick={clickable ? () => onSelect!(signal.id) : undefined}
              role={clickable ? "button" : undefined}
            >
              <span className={`dt ${signal.type}`} />
              <div className="bd">
                <div className="tt">
                  {signal.agent && (
                    <span className="atag">
                      <span className="mo" />
                      {signal.kind === "draft" ? "부사수" : "에이전트"}
                    </span>
                  )}
                  {signal.title}
                </div>
                <div className="mt">{signal.meta}</div>
              </div>
              {signal.badge && <span className={`bg ${signal.badge}`}>{signal.badgeLabel}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
