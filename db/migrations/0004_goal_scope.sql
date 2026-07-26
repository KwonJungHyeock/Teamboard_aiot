-- 파트 A/B — 팀/개인 목표 스코프 + 이벤트 기반 진척 저장.
-- scope: team(전원 공유, lead 편집) / personal(본인만). owner_actor_id 는 personal 필수(앱에서 강제).
ALTER TABLE goal ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'team';
ALTER TABLE goal DROP CONSTRAINT IF EXISTS goal_scope_check;
ALTER TABLE goal ADD CONSTRAINT goal_scope_check CHECK (scope IN ('team', 'personal'));

-- 진척을 이벤트 기반으로 저장(캐시)한다. 산출 불가(연결 업무 0 등)는 NULL 로 표현 → UI "-".
-- 기존 NOT NULL 제약 해제. 백필은 앱(lib/goals.recomputeAllGoals)이 최초 1회 수행한다.
ALTER TABLE goal ALTER COLUMN progress DROP NOT NULL;
