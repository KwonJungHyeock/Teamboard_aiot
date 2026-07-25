-- 파트 Y — 인수인계 자료. 담당자별 인수인계 문서 + 포함 업무 연결.
-- 비파괴(ADD/CREATE만). 소프트 삭제(is_active=false).
CREATE TABLE IF NOT EXISTS handover (
  id         SERIAL PRIMARY KEY,
  author_id  INTEGER NOT NULL REFERENCES actor(id),
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',          -- 마크다운 본문
  area_id    INTEGER REFERENCES area(id),        -- nullable (영역 지정 시 해당 영역 담당이 열람)
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'shared')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_handover_author ON handover(author_id, updated_at DESC);

-- 인수인계에 포함할 업무 연결 (선택 업무의 제목·상태·기한·자료가 문서에 자동 삽입)
CREATE TABLE IF NOT EXISTS handover_task (
  handover_id INTEGER NOT NULL REFERENCES handover(id),
  task_id     INTEGER NOT NULL REFERENCES task(id),
  PRIMARY KEY (handover_id, task_id)
);
