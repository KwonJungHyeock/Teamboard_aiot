-- 롤백: 0023_task_structure.sql
-- 실행 전 반드시 백업을 확인할 것. 이 스크립트는 컬럼을 지우므로 데이터가 사라진다.
--   - parent_task_id (하위 업무 관계), resolution (완료 사유), sort_order (정렬), goal_source
--   → 되돌리면 위 4개 값은 복구되지 않는다. 백업 dump 에서 복원해야 한다.
--
-- 되돌리지 않는 것: blocked / blocked_reason / blocked_since / blocked_by 는
-- 0023 이전부터 있던 컬럼이므로 건드리지 않는다.
--
--   psql "$DATABASE_URL" -f db/migrations/rollback/0023_task_structure_down.sql

BEGIN;

DROP TRIGGER IF EXISTS trg_task_delete_guard   ON task;
DROP TRIGGER IF EXISTS trg_task_blocked_derive ON task;
DROP TRIGGER IF EXISTS trg_task_block_cycle    ON task;
DROP TRIGGER IF EXISTS trg_task_depth_guard    ON task;

DROP FUNCTION IF EXISTS task_delete_guard();
DROP FUNCTION IF EXISTS task_blocked_derive();
DROP FUNCTION IF EXISTS task_block_cycle_guard();
DROP FUNCTION IF EXISTS task_depth_guard();

DROP INDEX IF EXISTS idx_task_project_sort;
DROP INDEX IF EXISTS idx_task_blocked_by;
DROP INDEX IF EXISTS idx_task_parent;

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_blocked_by_not_self;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_parent_not_self;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_goal_source_check;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_resolution_only_done;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_resolution_check;

ALTER TABLE task
  DROP COLUMN IF EXISTS goal_source,
  DROP COLUMN IF EXISTS resolution,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS parent_task_id;

DELETE FROM schema_migrations WHERE filename = '0023_task_structure.sql';

COMMIT;
