-- 성과 스냅샷 적립 (MD-P-2026-011, add-only)
-- 0018은 월 단위(period_ym) 1건이었다. 월말 트리거는 달마다 마지막 날이 달라 오작동 위험이 크므로
-- 일 1회 적립으로 바꾼다(월중 추이도 볼 수 있게 된다). 기존 행은 지우지 않고 날짜를 부여해 잇는다.

ALTER TABLE goal_snapshot ADD COLUMN IF NOT EXISTS snapshot_date        DATE;
ALTER TABLE goal_snapshot ADD COLUMN IF NOT EXISTS status               TEXT;
ALTER TABLE goal_snapshot ADD COLUMN IF NOT EXISTS linked_project_count INTEGER;
ALTER TABLE goal_snapshot ADD COLUMN IF NOT EXISTS source               TEXT NOT NULL DEFAULT 'auto';

-- 기존 행(리포트 열람 시 실제로 캡처된 값)에 KST 기준 날짜를 준다. 값은 건드리지 않는다.
UPDATE goal_snapshot
   SET snapshot_date = (captured_at AT TIME ZONE 'Asia/Seoul')::date
 WHERE snapshot_date IS NULL;

-- 월 단위 유일 제약은 일 단위 적립과 공존할 수 없다(같은 달에 여러 행이 생긴다).
ALTER TABLE goal_snapshot DROP CONSTRAINT IF EXISTS goal_snapshot_goal_id_period_ym_key;
ALTER TABLE goal_snapshot ALTER COLUMN period_ym DROP NOT NULL;
ALTER TABLE goal_snapshot ALTER COLUMN snapshot_date SET NOT NULL;

-- 재실행 시 upsert 되도록 (goal_id, snapshot_date) 유일
CREATE UNIQUE INDEX IF NOT EXISTS uq_goal_snapshot_day ON goal_snapshot (goal_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_goal_snapshot_date ON goal_snapshot (snapshot_date DESC, goal_id);

ALTER TABLE goal_snapshot DROP CONSTRAINT IF EXISTS goal_snapshot_source_check;
ALTER TABLE goal_snapshot ADD CONSTRAINT goal_snapshot_source_check
  CHECK (source IN ('auto', 'manual'));

-- 적립 실행 이력 (§F) — 성공·실패, 건수, 소요시간을 남겨 조회할 수 있게.
CREATE TABLE IF NOT EXISTS snapshot_run (
  id          SERIAL PRIMARY KEY,
  run_date    DATE NOT NULL,
  source      TEXT NOT NULL DEFAULT 'auto',
  ok          BOOLEAN NOT NULL,
  goal_count  INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshot_run_recent ON snapshot_run (created_at DESC);

-- 시스템 알림 (§F) — cron 연속 실패를 활동 인박스 "시스템" 탭에 알린다.
-- MD-P-2026-007은 그 작업 범위 안에서 새 타입을 금지했고, 이번 지시서 §F가
-- 시스템 채널 알림을 명시적으로 요구하므로 여기서 한 종류만 추가한다.
ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_type_check;
ALTER TABLE notification ADD CONSTRAINT notification_type_check
  CHECK (type IN ('mention', 'assign', 'reply', 'approval', 'share', 'deadline', 'overdue', 'system'));
