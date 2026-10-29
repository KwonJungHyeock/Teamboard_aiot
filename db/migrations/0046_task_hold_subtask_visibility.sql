-- QA (2026-10-29) — 상태 「보류」 · 하위 업무 공개 범위.
--
--   1) 상태에 hold(보류)를 더한다. 진척 분모에는 그대로 남는다(끝난 일이 아니다) — 중단(dropped)만 빠진다.
--   2) 상위가 팀 공개인데 개인으로 남은 하위 업무(체크리스트 항목)를 팀 공개로 맞춘다.
--      상위를 팀으로 바꿔도 하위가 따라가지 않아, 팀에는 상위만 보이고 항목은 사라져 보였다.
--      이제부터는 API 가 상위를 바꿀 때 하위도 함께 바꾼다(app/api/tasks/[id]).
-- 되돌리기: db/migrations/rollback/0046_task_hold_subtask_visibility_down.sql (2 는 되돌리지 않는다)

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_status_check;
ALTER TABLE task ADD CONSTRAINT task_status_check
  CHECK (status IN ('proposed', 'todo', 'doing', 'review', 'hold', 'done', 'dropped'));

UPDATE task c SET visibility = 'team', updated_at = now()
  FROM task p
 WHERE c.parent_task_id = p.id AND p.visibility = 'team' AND c.visibility = 'private';
