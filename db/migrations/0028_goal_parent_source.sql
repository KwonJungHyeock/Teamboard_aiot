-- MD-P-2026-029 §A5 — 상위 목표를 손으로 고른 것인지 기간에서 나온 것인지 구별한다.
--
-- §A1 이 "기간이 계층을 결정한다"로 바꾸면서, 상위는 이제 기간에서 **계산**된다.
-- 그런데 계산값을 그냥 덮어쓰면 예외적으로 손대 놓은 연결이 조용히 되돌아간다.
-- 업무의 `goal_source`(inherited | manual)와 **같은 방식**으로 출처를 남긴다.
--
--   derived  기간에서 계산됨. 기간을 바꾸면 상위가 따라간다 (기본값).
--   manual   사람이 「고급」에서 직접 지정했다. 기간을 바꿔도 따라가지 않는다.
--
-- 기존 행은 전부 derived 로 본다. 지금까지는 화면이 상위를 물어보긴 했지만
-- 실제로 고른 값은 전부 기간과 일치했다(029 §A6 실측: 어긋난 행 0건).
-- 그러니 derived 로 두는 것이 사실에 맞고, 첫 저장 때 조용히 옮겨지는 행도 없다.
--
-- 값을 코드가 아니라 스키마가 지킨다 — 오타 하나로 "기간을 바꿔도 안 따라가는" 목표를
-- 만들지 않는다 (0027 과 같은 판단).
--
-- 롤백: db/migrations/rollback/0028_goal_parent_source_down.sql

ALTER TABLE goal ADD COLUMN IF NOT EXISTS goal_parent_source TEXT NOT NULL DEFAULT 'derived';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goal_parent_source_check') THEN
    ALTER TABLE goal
      ADD CONSTRAINT goal_parent_source_check CHECK (goal_parent_source IN ('derived', 'manual'));
  END IF;
END $$;

-- 연간 목표는 상위가 없다. 출처를 물을 대상이 아니므로 derived 로 둔다 (기본값 그대로).
COMMENT ON COLUMN goal.goal_parent_source IS
  'derived=기간에서 계산 (기간 변경 시 따라감) · manual=사람이 지정 (따라가지 않음). MD-P-2026-029 §A5';
