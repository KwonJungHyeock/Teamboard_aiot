-- MD-P-2026-024 회신 7 [확정 23] — "목표 없음"을 정식 상태로 인정한다.
--
-- 모든 업무가 목표에 붙어야 하는 것은 아니다. 운영·잡무는 영역만 갖고 목표 없이 돈다.
-- 문제는 지금 구조가 두 가지를 구분하지 못한다는 것이다:
--   · 미지정   — 아직 목표를 안 정했다. 붙여야 한다.
--   · 목표 없음 — 성과 집계 대상이 아니다. 이대로가 맞다.
--
-- **컬럼을 추가하지 않는다.** 이미 있는 task.goal_source 에 값 하나를 더한다(지시 23-1).
--   inherited = 프로젝트에서 따라온 것 (기본값, 링크 없으면 "미지정")
--   manual    = 사용자가 직접 고른 것
--   none      = 사용자가 "목표 없음"을 명시적으로 고른 것  ← 이번에 추가
--
-- 롤백: db/migrations/rollback/0024_goal_none_down.sql

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_goal_source_check;
ALTER TABLE task ADD CONSTRAINT task_goal_source_check
  CHECK (goal_source IN ('inherited', 'manual', 'none'));

-- 기존 데이터는 건드리지 않는다. "목표 없음"은 사람이 고르는 것이지 추정하는 것이 아니다.
