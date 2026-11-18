-- 업무 요청 · 우선순위 (2026-11-18) — 팀원끼리 업무를 부탁하고, 급한 정도를 표시한다.
--
--   ① 우선순위에 「긴급」(urgent)을 더한다. 기존 높음 · 보통 · 낮음(노션에서 가져온 값 포함)은 그대로.
--      화면 표기: 긴급 · 높음 · 보통 · 낮음(여유). 보통은 표시하지 않는다.
--   ② task_request — 부탁은 받는 사람이 수락해야 업무가 된다. 수락 전에는 업무 목록 · 통계에 안 섞인다.
--      수락하면 task 를 만들고 task_id 로 잇는다. 거절 · 취소는 지우지 않고 상태로 남긴다(soft).
-- 되돌리기: db/migrations/rollback/0050_task_request_priority_down.sql

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_priority_check;
ALTER TABLE task ADD CONSTRAINT task_priority_check CHECK (priority IN ('urgent', 'high', 'mid', 'low'));

CREATE TABLE IF NOT EXISTS task_request (
  id            SERIAL PRIMARY KEY,
  team_id       INTEGER NOT NULL DEFAULT 1,
  from_id       INTEGER NOT NULL REFERENCES actor(id),
  to_id         INTEGER NOT NULL REFERENCES actor(id),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  due_date      DATE,
  priority      TEXT NOT NULL DEFAULT 'mid' CHECK (priority IN ('urgent', 'high', 'mid', 'low')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'canceled')),
  reply         TEXT,
  task_id       INTEGER REFERENCES task(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  CONSTRAINT task_request_not_self CHECK (from_id <> to_id)
);
CREATE INDEX IF NOT EXISTS idx_task_request_to ON task_request (to_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_request_from ON task_request (from_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_request_task ON task_request (task_id) WHERE task_id IS NOT NULL;
