-- 학습 전이 계층 (MD-P-2026-006, 비파괴)
-- 저장됨(Slack "Saved items") — 사람이 나중에 다시 찾을 항목 북마크.
CREATE TABLE IF NOT EXISTS saved_item (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES actor(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('task', 'signal', 'decision', 'project')),
  target_id   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_item (user_id, created_at DESC);

-- 읽음 표시(F) — 목록별 "여기까지 읽음" 기준선.
CREATE TABLE IF NOT EXISTS read_marker (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES actor(id),
  scope      TEXT NOT NULL,              -- 'activity' | 'signals' | 'project:12' 등
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope)
);
