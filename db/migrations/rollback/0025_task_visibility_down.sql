-- 롤백: MD-P-2026-025 §A2 (0025_task_visibility.sql)
--
-- ⚠️ 이 롤백은 **개인 업무를 팀 공개로 되돌린다.**
--    visibility 컬럼이 사라지면 private 이었다는 사실 자체가 남지 않는다.
--    실행 전 반드시 아래 조회로 몇 건이 노출되는지 확인할 것.
--
--      SELECT count(*) FROM task WHERE visibility = 'private';
--
--    0건이 아니면 사람에게 알리고 승인을 받은 뒤에 실행한다.
--    (MD-P-2026-024 회신 5 — 파괴적 변경에는 건수 확인을 기본으로 둔다)

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM task WHERE visibility = 'private';
  IF n > 0 THEN
    RAISE WARNING '개인 업무 %건이 팀 공개로 전환됩니다. 의도한 것이 맞는지 확인하세요.', n;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_task_private_owner ON task;
DROP FUNCTION IF EXISTS task_private_owner_guard();

DROP INDEX IF EXISTS idx_task_private;
DROP INDEX IF EXISTS idx_task_owner_visibility;

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_private_no_project;
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_visibility_check;
ALTER TABLE task DROP COLUMN IF EXISTS visibility;
