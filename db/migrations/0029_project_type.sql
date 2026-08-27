-- MD-P-2026-032 §A1 — 프로젝트 종류 (배치 ①/③)
--
--   goal      목표에 연결되는 프로젝트. 성과 집계에 든다.
--   standing  상시·기타. **목표 없음이 정상 상태다.**
--             「목표에 연결되지 않았습니다」 안내에서 제외한다.
--
-- 기본값을 'goal' 로 두는 이유 — 지금 있는 프로젝트는 전부 목표에 붙을 것들이다.
-- 상시 프로젝트만 배치 ②에서 'standing' 으로 넣는다.
--
-- 비파괴다: ADD COLUMN + CHECK 뿐이고 기존 행의 값을 바꾸지 않는다.
ALTER TABLE project
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'goal';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_type_check') THEN
    ALTER TABLE project ADD CONSTRAINT project_type_check
      CHECK (type IN ('goal', 'standing'));
  END IF;
END $$;

-- §A4 — 상시 프로젝트는 목표를 갖지 않는다. **서버 코드가 아니라 여기서 막는다.**
-- 코드에서만 막으면 경로가 늘 때마다 한 곳을 빠뜨린다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_standing_no_goal') THEN
    ALTER TABLE project ADD CONSTRAINT project_standing_no_goal
      CHECK (type <> 'standing' OR goal_id IS NULL);
  END IF;
END $$;

-- 되돌리기 (db/migrations/rollback 규약 — 이력을 지우지 않고 별도 파일로 실행한다)
--   ALTER TABLE project DROP CONSTRAINT IF EXISTS project_standing_no_goal;
--   ALTER TABLE project DROP CONSTRAINT IF EXISTS project_type_check;
--   ALTER TABLE project DROP COLUMN IF EXISTS type;
