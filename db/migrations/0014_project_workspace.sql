-- 프로젝트 워크스페이스 통합 (MD-P-2026-005, 비파괴)
-- status는 코드베이스 관례에 따라 영문 enum, 표기는 UI에서 진행/보류/완료/보관.
ALTER TABLE project ADD COLUMN IF NOT EXISTS goal_id integer REFERENCES goal(id);
ALTER TABLE project ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE project ADD COLUMN IF NOT EXISTS owner_id integer REFERENCES actor(id);
ALTER TABLE project ADD COLUMN IF NOT EXISTS member_ids integer[] NOT NULL DEFAULT '{}';

-- 기존 CHECK(active|done|hold)에 archived 추가
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_status_check;
ALTER TABLE project ADD CONSTRAINT project_status_check
  CHECK (status IN ('active', 'hold', 'done', 'archived'));

CREATE INDEX IF NOT EXISTS idx_project_goal ON project (goal_id);

-- 프로젝트 캔버스 — 프로젝트당 1개. 과정 기록(자료조사·설계 메모·참고 링크)의 본체.
-- blocks: [{id, type:'text'|'checklist'|'link'|'image', ...}] JSONB 배열.
CREATE TABLE IF NOT EXISTS project_canvas (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL UNIQUE REFERENCES project(id),
  blocks     JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES actor(id)
);
