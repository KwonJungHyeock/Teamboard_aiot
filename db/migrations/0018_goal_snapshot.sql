-- 월별 성과 리포트 (MD-P-2026-010) — 목표 진척 월말 스냅샷.
-- 전월 대비 증감을 "정직하게" 내려면 과거 값이 실제로 남아 있어야 한다.
-- 스냅샷이 없는 달은 증감을 추정하지 않고 아예 표시하지 않는다(§E).
CREATE TABLE IF NOT EXISTS goal_snapshot (
  id          SERIAL PRIMARY KEY,
  goal_id     INTEGER NOT NULL REFERENCES goal(id),
  period_ym   TEXT NOT NULL,              -- '2026-08'
  progress    NUMERIC,                    -- NULL = 집계 대상 없음 (0%와 구분)
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (goal_id, period_ym)
);
CREATE INDEX IF NOT EXISTS idx_goal_snapshot_ym ON goal_snapshot (period_ym, goal_id);
