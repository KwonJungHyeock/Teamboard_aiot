-- 막힌 업무(blocked) 플래그 — 상태(진행/대기 등)와 별개인 "진행 불가" 신호(비파괴).
-- blocked는 상태와 겹칠 수 있고, 해제 시 이전 상태를 그대로 유지한다.
-- blocked_reason은 표시 시 필수(코드 측 검증). blocked_by는 선택(의존 업무).
ALTER TABLE task ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
ALTER TABLE task ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE task ADD COLUMN IF NOT EXISTS blocked_since timestamptz;
ALTER TABLE task ADD COLUMN IF NOT EXISTS blocked_by integer REFERENCES task(id);

CREATE INDEX IF NOT EXISTS idx_task_blocked ON task (blocked) WHERE blocked = true;
