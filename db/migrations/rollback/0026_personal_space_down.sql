-- 롤백: MD-P-2026-025 §C·§D (0026_personal_space.sql)
--
-- ⚠️ 이 롤백은 **개인 메모와 개인 일정을 통째로 삭제한다.**
--    task.visibility 롤백과 달리 되돌릴 방법이 없다 — 테이블 자체가 사라진다.
--    실행 전 반드시 건수를 확인하고, 0건이 아니면 사람에게 알린 뒤 승인을 받을 것.
--
--      SELECT (SELECT count(*) FROM note)           AS notes,
--             (SELECT count(*) FROM personal_event) AS events;

DO $$
DECLARE n int; e int;
BEGIN
  SELECT count(*) INTO n FROM note;
  SELECT count(*) INTO e FROM personal_event;
  IF n > 0 OR e > 0 THEN
    RAISE EXCEPTION '개인 메모 %건 · 개인 일정 %건이 삭제됩니다. '
                    '의도한 것이면 이 DO 블록을 지우고 다시 실행하세요.', n, e;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_personal_event_owner;
DROP TABLE IF EXISTS personal_event;

DROP INDEX IF EXISTS idx_note_owner;
DROP TABLE IF EXISTS note;
