-- 수정 요청 — 맡긴 사람(또는 팀장)이 업무에 「이렇게 고쳐 주세요」를 단다 (2026-10 리디자인 · 내 업무 알림판).
--
--   requester_id  요청한 사람
--   memo          요청 내용 한 줄(최대 500자)
--   resolved_at   담당이 「수정 완료」를 누른 때. NULL 이면 아직 열려 있다
--
-- 업무 하나에 열린 요청은 하나만 둔다(새로 달면 이전 것은 닫힌다 — 코드에서).
-- 되돌리기: db/migrations/rollback/0043_task_revision_down.sql

CREATE TABLE IF NOT EXISTS task_revision (
  id            SERIAL PRIMARY KEY,
  task_id       INTEGER     NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  requester_id  INTEGER     NOT NULL REFERENCES actor(id),
  memo          TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   INTEGER     REFERENCES actor(id)
);
ALTER TABLE task_revision DROP CONSTRAINT IF EXISTS task_revision_memo_check;
ALTER TABLE task_revision ADD CONSTRAINT task_revision_memo_check CHECK (length(memo) <= 500);
CREATE INDEX IF NOT EXISTS idx_task_revision_open ON task_revision (task_id) WHERE resolved_at IS NULL;
