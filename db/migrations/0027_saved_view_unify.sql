-- MD-P-2026-027 §B3 — 저장된 뷰를 한 표로 통일한다.
--
-- 새로 만들지 않는다. `saved_view` 는 이미 있다 (0016_activity_inbox).
-- 활동 화면 전용으로 쓰이던 것을 업무·목표까지 받도록 **넓히는** 마이그레이션이다.
-- 같은 개념(저장된 조건)이 두 표로 갈리면 반드시 서로 낡는다.
--
-- 이름을 지시서대로 맞춘다:
--   user_id → owner_actor_id   FK 는 원래 actor(id) 를 가리키고 있었다.
--                              "user" 라 부르면서 actor 를 담고 있던 것이라 이름이 틀렸다.
--   filter  → filters
-- RENAME 이므로 **데이터는 그대로 보존된다.**
--
-- 새로 붙는 것:
--   target      어느 화면의 조건인가 (tasks | goals | activity)
--               기존 행은 전부 활동 화면 것이므로 'activity' 가 맞다. 추정이 아니라 사실이다.
--   sort_order  「내 공간」 아래 핀 순서. 드래그로 바꾼다.
--   is_pinned   핀 해제하면 목록에서만 보인다. 기본 true — 지금 동작이 그렇다.
--
-- 저장된 뷰는 **항상 개인이다.** 공유 옵션을 만들지 않는다 (지시서 §B3).
-- 그래서 visibility 컬럼이 없다 — 값이 하나뿐인 컬럼은 규칙이 아니라 장식이다(0026 과 같은 판단).
--
-- 롤백: db/migrations/rollback/0027_saved_view_unify_down.sql

-- ── 이름 정정 (데이터 보존) ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'saved_view' AND column_name = 'user_id') THEN
    ALTER TABLE saved_view RENAME COLUMN user_id TO owner_actor_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'saved_view' AND column_name = 'filter') THEN
    ALTER TABLE saved_view RENAME COLUMN filter TO filters;
  END IF;
END $$;

-- ── 확장 ──────────────────────────────────────────────────────────
ALTER TABLE saved_view ADD COLUMN IF NOT EXISTS target     TEXT    NOT NULL DEFAULT 'activity';
ALTER TABLE saved_view ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE saved_view ADD COLUMN IF NOT EXISTS is_pinned  BOOLEAN NOT NULL DEFAULT true;

-- 값을 코드가 아니라 스키마가 지킨다. 오타 하나로 목록에서 사라지는 뷰를 만들지 않는다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_view_target_check') THEN
    ALTER TABLE saved_view
      ADD CONSTRAINT saved_view_target_check CHECK (target IN ('tasks', 'goals', 'activity'));
  END IF;
END $$;

-- 이름 유일성은 **화면별로** 본다.
-- 업무의 "이번 주"와 활동의 "이번 주"는 다른 뷰이고, 둘 다 있어야 자연스럽다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_view_user_id_name_key') THEN
    ALTER TABLE saved_view DROP CONSTRAINT saved_view_user_id_name_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_view_owner_target_name_key') THEN
    ALTER TABLE saved_view
      ADD CONSTRAINT saved_view_owner_target_name_key UNIQUE (owner_actor_id, target, name);
  END IF;
END $$;

-- 접근 패턴은 하나다 — "내 뷰를, 이 화면 것만, 핀 순서대로".
DROP INDEX IF EXISTS idx_saved_view_user;
CREATE INDEX IF NOT EXISTS idx_saved_view_owner
  ON saved_view (owner_actor_id, target, sort_order, id);

-- ── 기존 행 ───────────────────────────────────────────────────────
-- 지금 있는 뷰는 전부 활동 화면에서 만든 것이다 (0016 이후 다른 경로가 없었다).
-- DEFAULT 로 이미 'activity' 가 들어가지만, 나중에 DEFAULT 를 바꿔도 안전하도록 명시한다.
UPDATE saved_view SET target = 'activity' WHERE target IS NULL OR target = '';
-- 핀 순서는 만든 순서를 그대로 물려받는다. 0 이 여럿이면 정렬이 흔들린다.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY owner_actor_id, target ORDER BY created_at, id) AS n
  FROM saved_view
)
UPDATE saved_view v SET sort_order = ranked.n FROM ranked
WHERE v.id = ranked.id AND v.sort_order = 0;
