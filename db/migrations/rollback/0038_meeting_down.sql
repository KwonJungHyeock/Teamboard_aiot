-- 롤백: 회의실 (0038_meeting.sql)
--
-- ⚠️ 이 롤백은 **회의 · 참석 · 안건 · 결정 · 할 일 메모 · 회의록을 통째로 지운다.** 되돌릴 방법이 없다.
--    회의에서 「할 일로 만들기」로 생긴 업무(task)는 지우지 않는다 — 업무 표에 따로 있다.
--    실행 전 건수를 보고, 0건이 아니면 사람에게 알리고 승인을 받을 것.
--
--      SELECT (SELECT count(*) FROM meeting) AS meetings, (SELECT count(*) FROM meeting_item) AS items;

DO $$
DECLARE m int; i int;
BEGIN
  SELECT count(*) INTO m FROM meeting;
  SELECT count(*) INTO i FROM meeting_item;
  IF m > 0 OR i > 0 THEN
    RAISE EXCEPTION '회의 %건 · 회의 항목 %건이 삭제됩니다. '
                    '의도한 것이면 이 DO 블록을 지우고 다시 실행하세요.', m, i;
  END IF;
END $$;

DROP TABLE IF EXISTS meeting_item;
DROP TABLE IF EXISTS meeting_attendee;
DROP TABLE IF EXISTS meeting;
