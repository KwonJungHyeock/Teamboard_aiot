-- 홈/목표 보완 (비파괴) — 리뷰세션 예정 시각 + 목표 레벨/기간 필드.

-- (A1) 예정 리뷰세션 — 다가오는 일정에서 미래 리뷰를 노출하기 위한 시각.
ALTER TABLE review_session ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- (C) 목표 레벨/기간 — 연간·분기 동시 표시용. 기존 목표는 period_type에서 백필.
ALTER TABLE goal ADD COLUMN IF NOT EXISTS level text;   -- annual | quarter
ALTER TABLE goal ADD COLUMN IF NOT EXISTS period text;  -- 연간='2026', 분기='2026-Q3'

UPDATE goal SET level = 'annual', period = to_char(period_start, 'YYYY')
 WHERE level IS NULL AND period_type = 'year';
UPDATE goal SET level = 'quarter',
   period = to_char(period_start, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM period_start)::int
 WHERE level IS NULL AND period_type = 'quarter';
