-- 팀 피드백 2차 (2026-10-30) — 공동 담당: 주담당 1명(task.assignee_id) + 「함께하는 사람」.
--
--   · 주담당은 그대로 task.assignee_id 다. 집계 · 보고 · 성과 분석은 **주담당만** 센다.
--   · 함께하는 사람은 이 표에 둔다. 내 업무 · 담당 거르기에 보이고, 업무를 고칠 수 있다.
--   · 빼는 것은 소프트 삭제(is_active = false). 다시 넣으면 그 줄을 되살린다.
--   · 개인(나만) 업무에는 함께하는 사람을 둘 수 없다 — API 가 막는다.
-- 되돌리기: db/migrations/rollback/0048_task_member_down.sql

CREATE TABLE IF NOT EXISTS task_member (
  task_id    INTEGER NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  actor_id   INTEGER NOT NULL REFERENCES actor(id),
  added_by   INTEGER REFERENCES actor(id),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, actor_id)
);
CREATE INDEX IF NOT EXISTS task_member_actor_idx ON task_member (actor_id) WHERE is_active;
