-- 목표↔프로젝트 연결 및 성과 집계 (MD-P-2026-009, add-only)
-- 홈 목표 진척이 전부 "-"인 원인은 집계 코드가 아니라 연결 데이터가 없어서다.
-- 여기서는 스키마만 채우고(파괴적 변경 없음), 연결 UI와 집계는 앱에서 처리한다.

-- 1) 진척을 "수동 입력"과 "집계 결과"로 분리한다.
--    progress는 지금까지처럼 "실효값"(manual ?? auto)을 유지해 기존 조회부가 그대로 동작한다.
ALTER TABLE goal ADD COLUMN IF NOT EXISTS progress_manual NUMERIC;   -- 사용자가 직접 넣은 값
ALTER TABLE goal ADD COLUMN IF NOT EXISTS progress_auto   NUMERIC;   -- 집계 결과(읽기 전용)

-- 기존 값 이관 — manual 모드면 수동값으로, auto 모드면 집계값으로 옮긴다.
UPDATE goal SET progress_manual = progress
 WHERE progress_mode = 'manual' AND progress_manual IS NULL AND progress IS NOT NULL;
UPDATE goal SET progress_auto = progress
 WHERE progress_mode = 'auto' AND progress_auto IS NULL AND progress IS NOT NULL;

-- 2) 상태 수동 지정 — 기본은 자동 판정(§D), 값이 있으면 수동 우선.
ALTER TABLE goal ADD COLUMN IF NOT EXISTS status_manual TEXT;
ALTER TABLE goal DROP CONSTRAINT IF EXISTS goal_status_manual_check;
ALTER TABLE goal ADD CONSTRAINT goal_status_manual_check
  CHECK (status_manual IS NULL OR status_manual IN ('ontrack', 'risk', 'wait', 'done'));

-- 3) level·period 백필 — 월 목표까지 포함(annual | quarter | month).
UPDATE goal SET level = CASE period_type
    WHEN 'year' THEN 'annual' WHEN 'quarter' THEN 'quarter' ELSE 'month' END
 WHERE level IS NULL;
UPDATE goal SET period = CASE period_type
    WHEN 'year'    THEN to_char(period_start, 'YYYY')
    WHEN 'quarter' THEN to_char(period_start, 'YYYY') || '-Q' || EXTRACT(QUARTER FROM period_start)::int
    ELSE                to_char(period_start, 'YYYY-MM') END
 WHERE period IS NULL;

ALTER TABLE goal DROP CONSTRAINT IF EXISTS goal_level_check;
ALTER TABLE goal ADD CONSTRAINT goal_level_check
  CHECK (level IS NULL OR level IN ('annual', 'quarter', 'month'));

-- 4) 개인 목표는 소유자가 반드시 있어야 한다(팀 목표는 nullable 유지).
--    기존 데이터에 소유자 없는 personal이 있으면 팀으로 되돌려 정합성을 지킨다.
UPDATE goal SET scope = 'team' WHERE scope = 'personal' AND owner_actor_id IS NULL;

-- 5) 목표별 프로젝트 조회 인덱스 — 집계가 이 경로를 자주 탄다.
CREATE INDEX IF NOT EXISTS idx_project_goal ON project (goal_id) WHERE goal_id IS NOT NULL;
