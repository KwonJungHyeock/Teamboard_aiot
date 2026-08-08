"use client";

// 페이지 뼈대 (MD-P-2026-019 §B) — 전 화면 공통.
// 위에서 아래로 고정 순서: 브레드크럼 → 제목+액션 → 탭 → 필터바 → 본문.
// 화면마다 다시 짜지 않는다. 순서를 바꾸고 싶으면 여기만 고친다.
import { useLayoutEffect, useRef, type ReactNode } from "react";

export interface ShellTab {
  key: string;
  label: string;
  /** 탭 옆 숫자 (0/undefined면 표시 안 함) */
  count?: number;
}

export default function PageShell({
  crumb,
  title,
  subtitle,
  actions,
  tabs,
  activeTab,
  onTab,
  filters,
  filterSummary,
  children,
}: {
  /** 브레드크럼 조각 — 마지막이 현재 화면 */
  crumb: string[];
  /**
   * 문자열이 기본. 노드는 **인라인 편집 입력 · 상태 칩 · 목표 링크** 만 허용한다.
   * 버튼 · 탭 · 필터 · 드롭다운은 넣지 않는다 — 각각 actions / tabs / filters 슬롯이 이미 있다.
   * (MD-P-2026-022 §A 승인 조건)
   */
  title: ReactNode;
  /** 같은 제한이 적용된다 — 칩·링크까지. 조작 요소는 슬롯을 쓴다 */
  subtitle?: ReactNode;
  /** 우측 정렬 액션. 주 액션 1개만 코랄(btn-primary), 나머지는 btn-ghost */
  actions?: ReactNode;
  tabs?: ShellTab[];
  activeTab?: string;
  onTab?: (key: string) => void;
  /** 필터 칩·셀렉트. **선택 슬롯** — 페이지 레벨 필터가 없는 화면은 넘기지 않는다(필터바가 그려지지 않는다) */
  filters?: ReactNode;
  /** 필터바 우측 끝 건수·요약 텍스트 */
  filterSummary?: ReactNode;
  children: ReactNode;
}) {
  // H3-⑪ 탭 밑줄 — 활성 탭의 x·너비를 CSS 변수로 넘긴다.
  // 위치를 읽어 오는 것이므로 레이아웃 확정 후(useLayoutEffect) 한 번만 잰다.
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = tabsRef.current;
    if (!root) return;
    const on = root.querySelector<HTMLElement>(".pg-tab.on");
    if (!on) { root.style.setProperty("--w", "0"); return; }
    root.style.setProperty("--x", `${on.offsetLeft}px`);
    root.style.setProperty("--w", `${on.offsetWidth}`);
  }, [activeTab, tabs]);

  return (
    <div className="pg">
      <header className="pg-head">
        <nav className="pg-crumb" aria-label="위치">
          {crumb.map((c, i) => (
            <span key={c + i}>
              {i > 0 && <i className="pg-crumb-sep" aria-hidden="true">/</i>}
              {i === crumb.length - 1 ? <b>{c}</b> : c}
            </span>
          ))}
        </nav>

        <div className="pg-title">
          <div className="pg-title-l">
            <h1>{title}</h1>
            {subtitle && <p className="pg-sub">{subtitle}</p>}
          </div>
          {actions && <div className="pg-act">{actions}</div>}
        </div>

        {tabs && tabs.length > 0 && (
          <div className="pg-tabs" role="tablist" ref={tabsRef}>
            {/* H3-⑪ 활성 밑줄은 탭마다 그리지 않고 **하나**를 옮긴다.
                각자 그리면 켜지고 꺼질 뿐 미끄러지지 않는다. */}
            <span className="tabline" aria-hidden="true" />
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                className={`pg-tab${activeTab === t.key ? " on" : ""}`}
                onClick={() => onTab?.(t.key)}
              >
                {t.label}
                {t.count ? <em className="pg-tab-n num">{t.count}</em> : null}
              </button>
            ))}
          </div>
        )}
      </header>

      {filters && (
        <div className="pg-filters">
          {filters}
          {filterSummary && <span className="pg-filter-sum num">{filterSummary}</span>}
        </div>
      )}

      <div className="pg-body">{children}</div>
    </div>
  );
}
