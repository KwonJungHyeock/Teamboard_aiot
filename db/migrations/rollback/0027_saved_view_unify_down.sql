-- 0027 롤백 — 저장된 뷰 확장 되돌리기.
--
-- 되돌리면 **업무·목표 뷰는 갈 곳이 없어진다.** 활동 화면 것만 남는 표로 돌아가기 때문이다.
-- 그래서 지우기 전에 세고, 있으면 멈춘다. 조용히 버리지 않는다.

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM saved_view WHERE target IN ('tasks', 'goals');
  IF n > 0 THEN
    RAISE EXCEPTION
      '업무·목표 저장된 뷰가 %건 있습니다. 롤백하면 이 뷰들은 되살릴 수 없습니다. '
      '먼저 내보내거나 지운 뒤 다시 실행하세요.', n;
  END IF;
END $$;

ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_owner_target_name_key;
ALTER TABLE saved_view DROP CONSTRAINT IF EXISTS saved_view_target_check;
DROP INDEX IF EXISTS idx_saved_view_owner;

ALTER TABLE saved_view DROP COLUMN IF EXISTS is_pinned;
ALTER TABLE saved_view DROP COLUMN IF EXISTS sort_order;
ALTER TABLE saved_view DROP COLUMN IF EXISTS target;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'saved_view' AND column_name = 'filters') THEN
    ALTER TABLE saved_view RENAME COLUMN filters TO filter;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'saved_view' AND column_name = 'owner_actor_id') THEN
    ALTER TABLE saved_view RENAME COLUMN owner_actor_id TO user_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saved_view_user ON saved_view (user_id, created_at);
ALTER TABLE saved_view ADD CONSTRAINT saved_view_user_id_name_key UNIQUE (user_id, name);
