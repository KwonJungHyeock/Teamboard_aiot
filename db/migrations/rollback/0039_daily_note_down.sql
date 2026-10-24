-- 롤백: 하루 한 줄 · 상태 (0039_daily_note.sql)
--
-- ⚠️ 이 롤백은 **모든 사람의 하루 한 줄과 상태 기록을 통째로 지운다.** 되돌릴 방법이 없다.
--    실행 전 건수를 보고, 0건이 아니면 사람에게 알리고 승인을 받을 것.
--
--      SELECT count(*) FROM daily_note;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM daily_note;
  IF n > 0 THEN
    RAISE EXCEPTION '하루 한 줄 · 상태 %건이 삭제됩니다. 의도한 것이면 이 DO 블록을 지우고 다시 실행하세요.', n;
  END IF;
END $$;

DROP TABLE IF EXISTS daily_note;
