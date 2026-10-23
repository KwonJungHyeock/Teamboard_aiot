-- 롤백: 업무기록 (0037_work_log.sql)
--
-- ⚠️ 이 롤백은 **업무기록과 내 카테고리를 통째로 지운다.** 되돌릴 방법이 없다.
--    Blob 의 `worklog/…` 파일은 지우지 않는다 — 남은 파일은 따로 정리한다.
--    실행 전 건수를 보고, 0건이 아니면 사람에게 알리고 승인을 받을 것.
--
--      SELECT (SELECT count(*) FROM work_log)          AS logs,
--             (SELECT count(*) FROM work_log_category) AS categories;

DO $$
DECLARE l int; c int;
BEGIN
  SELECT count(*) INTO l FROM work_log;
  SELECT count(*) INTO c FROM work_log_category;
  IF l > 0 OR c > 0 THEN
    RAISE EXCEPTION '업무기록 %건 · 카테고리 %건이 삭제됩니다. '
                    '의도한 것이면 이 DO 블록을 지우고 다시 실행하세요.', l, c;
  END IF;
END $$;

DROP TABLE IF EXISTS work_log;
DROP TABLE IF EXISTS work_log_category;
