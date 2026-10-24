-- 롤백: 월간 보고(개인) (0042_monthly_report.sql)
--
-- ⚠️ 이 롤백은 **모든 사람의 월간 보고 글과 팀장 코멘트를 지운다.** 되돌릴 방법이 없다.
--      SELECT count(*) AS reports, count(*) FILTER (WHERE status = 'submitted') AS submitted FROM monthly_report;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM monthly_report;
  IF n > 0 THEN
    RAISE EXCEPTION '월간 보고 %건이 삭제됩니다. 의도한 것이면 이 DO 블록을 지우고 다시 실행하세요.', n;
  END IF;
END $$;

DROP TABLE IF EXISTS monthly_report;
