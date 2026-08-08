-- MD-P-2026-029 §A5 — 상위 목표를 손으로 고른 것인지 기간에서 나온 것인지 구별한다.
--
-- §A1 이 "기간이 계층을 결정한다"로 바꾸면서, 상위는 이제 기간에서 **계산**된다.
-- 그런데 계산값을 그냥 덮어쓰면 예외적으로 손대 놓은 연결이 조용히 되돌아간다.
-- 업무의 `goal_source`(inherited | manual)와 **같은 방식**으로 출처를 남긴다.
--
--   derived  기간에서 계산됨. 기간을 바꾸면 상위가 따라간다.
--   placed   **만든 자리**가 정했다. 분기 섹션의 "+ 월 목표"로 만들면 그 분기가 상위다.
--   manual   사람이 「고급」에서 직접 지정했다.
--
-- placed 와 manual 은 기간을 바꿔도 따라가지 않는다. derived 만 따라간다.
--
-- **왜 placed 가 1순위인가** (029 §A 회신 [확정 A-신1]).
-- 이 팀은 분기 목표를 "큰 과제", 월 목표를 "세부 과제"로 쓴다. 기간은 부차적이다.
-- 프로덕션의 2026 Q3 분기 목표가 넷이라, 기간만으로는 상위가 하나로 좁혀지지 않고
-- 매번 4지 선택이 뜬다. 사람은 이미 "어느 분기 아래에" 만들지 알고 그 자리를 눌렀다 —
-- 그 사실을 버리고 다시 묻는 것이 잘못이었다. 기간 자동 귀속은 폴백으로 남긴다.
--
-- 기존 행은 전부 derived 로 본다. 지금까지 고른 값이 전부 기간과 일치했으므로
-- (§A6 로컬 실측: 어긋난 행 0건) 사실에 맞고, 첫 저장 때 조용히 옮겨지는 행도 없다.
-- 프로덕션 실태는 scripts/sql/md029/00_goal_hierarchy_audit.sql 로 따로 확인한다.
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
      ADD CONSTRAINT goal_parent_source_check CHECK (goal_parent_source IN ('derived', 'placed', 'manual'));
  END IF;
END $$;

-- 연간 목표는 상위가 없다. 출처를 물을 대상이 아니므로 derived 로 둔다 (기본값 그대로).
COMMENT ON COLUMN goal.goal_parent_source IS
  'derived=기간에서 계산(기간 변경 시 따라감) · placed=만든 자리가 정함 · manual=사람이 지정. placed/manual 은 따라가지 않음. MD-P-2026-029 §A5 · A-신1';
