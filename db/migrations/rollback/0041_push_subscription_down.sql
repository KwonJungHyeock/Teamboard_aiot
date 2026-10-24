-- 롤백: 데스크톱 알림 (0041_push_subscription.sql)
--
-- ⚠️ 이 롤백은 **모든 사람의 알림 기기 등록을 지운다.** 지우면 각자 「알림 켜기」를 다시 눌러야 한다.
--      SELECT count(*) FILTER (WHERE disabled_at IS NULL) AS live, count(*) AS all FROM push_subscription;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM push_subscription WHERE disabled_at IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '알림 받는 기기 %개가 지워집니다. 의도한 것이면 이 DO 블록을 지우고 다시 실행하세요.', n;
  END IF;
END $$;

DROP TABLE IF EXISTS push_subscription;
