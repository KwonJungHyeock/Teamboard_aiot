-- 롤백: Claude 연결 키 (0040_api_token.sql)
--
-- ⚠️ 이 롤백은 **모든 사람의 Claude 연결 키를 지운다.** 지우면 각자 Claude 연결이 끊긴다
--    (키를 새로 만들어 다시 붙여야 한다). 실행 전 건수를 보고 사람에게 알릴 것.
--
--      SELECT count(*) FILTER (WHERE revoked_at IS NULL) AS live, count(*) AS all FROM api_token;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM api_token WHERE revoked_at IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '살아 있는 Claude 연결 키 %개가 지워집니다. 의도한 것이면 이 DO 블록을 지우고 다시 실행하세요.', n;
  END IF;
END $$;

DROP TABLE IF EXISTS api_token;
