-- 롤백: 0046 — 보류(hold)를 시작 전(todo)으로 돌린 뒤 제약을 되돌린다.
-- 하위 업무 공개 범위 맞춤은 되돌리지 않는다(어느 것이 원래 개인이었는지 남겨 두지 않았다).
UPDATE task SET status = 'todo' WHERE status = 'hold';
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_status_check;
ALTER TABLE task ADD CONSTRAINT task_status_check
  CHECK (status IN ('proposed', 'todo', 'doing', 'review', 'done', 'dropped'));
