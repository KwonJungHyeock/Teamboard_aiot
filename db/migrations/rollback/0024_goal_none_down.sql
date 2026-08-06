-- 롤백: 0024_goal_none.sql
-- 'none' 을 쓰던 업무는 'inherited'(미지정)로 되돌아간다 — 그 선택 정보는 사라진다.
BEGIN;
UPDATE task SET goal_source = 'inherited' WHERE goal_source = 'none';
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_goal_source_check;
ALTER TABLE task ADD CONSTRAINT task_goal_source_check
  CHECK (goal_source IN ('inherited', 'manual'));
DELETE FROM schema_migrations WHERE filename = '0024_goal_none.sql';
COMMIT;
