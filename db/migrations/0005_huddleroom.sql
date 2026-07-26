-- 파트 D — 허들룸. 이미지 첨부(외부 URL) + 투표.
-- 허들/코멘트는 기존 signal/comment 테이블 사용. 비파괴 추가만.
ALTER TABLE signal  ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE comment ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 투표 — 허들(signal) 또는 코멘트에 👍/👎. 1인 1표(토글).
CREATE TABLE IF NOT EXISTS huddle_vote (
  target_type TEXT NOT NULL CHECK (target_type IN ('huddle', 'comment')),
  target_id   INTEGER NOT NULL,
  actor_id    INTEGER NOT NULL REFERENCES actor(id),
  vote        TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_type, target_id, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_huddle_vote_target ON huddle_vote(target_type, target_id);
