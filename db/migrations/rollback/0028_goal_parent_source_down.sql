-- 롤백: 0028_goal_parent_source.sql
--
-- **손으로 지정한 연결이 남아 있으면 멈춘다.**
-- 컬럼을 지우면 "이 상위는 사람이 정한 것"이라는 사실이 사라지고,
-- 다음 저장에서 기간 기준으로 조용히 옮겨진다. 되돌릴 수 없는 손실이다.
-- 0027 롤백과 같은 판단이다 — 새 값이 이미 쓰이고 있으면 되돌리지 않는다.

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM goal WHERE goal_parent_source IN ('manual', 'placed');
  IF n > 0 THEN
    RAISE EXCEPTION '사람이 정한(manual) 또는 만든 자리가 정한(placed) 목표가 %건 있습니다. 롤백하면 그 사실이 사라지고 다음 저장에서 기간 기준으로 옮겨집니다. 먼저 정리하세요.', n;
  END IF;
END $$;

ALTER TABLE goal DROP CONSTRAINT IF EXISTS goal_parent_source_check;
ALTER TABLE goal DROP COLUMN IF EXISTS goal_parent_source;
