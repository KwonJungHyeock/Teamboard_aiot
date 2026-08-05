"use client";

// 페이지 뼈대 (MD-P-2026-019 §B) — 전 화면 공통.
// 위에서 아래로 고정 순서: 브레드크럼 → 제목+액션 → 탭 → 필터바 → 본문.
// 화면마다 다시 짜지 않는다. 순서를 바꾸고 싶으면 여기만 고친다.
import type { ReactNode } from "react";

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
  title: string;
  subtitle?: string;
  /** 우측 정렬 액션. 주 액션 1개만 코랄(btn-primary), 나머지는 btn-ghost */
  actions?: ReactNode;
  tabs?: ShellTab[];
  activeTab?: string;
  onTab?: (key: string) => void;
  /** 필터 칩·셀렉트. 없으면 필터바 자체를 그리지 않는다 */
  filters?: ReactNode;
  /** 필터바 우측 끝 건수·요약 텍스트 */
  filterSummary?: ReactNode;
  children: ReactNode;
}) {
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
          <div className="pg-tabs" role="tablist">
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
