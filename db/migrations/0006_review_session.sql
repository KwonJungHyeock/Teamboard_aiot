-- 허들룸 리뷰 세션 — 섹션(안건)별 이전/이후 비교 → 코멘트 → 확정/수정/보류 → 옵션 선정.
-- 이미지는 URL만 저장(Vercel Blob 업로드 URL). blob 자체는 Postgres에 넣지 않는다(기존 이미지URL 원칙).
-- 코멘트는 기존 comment 테이블 재사용(review_item_id 스코프). 비파괴 추가만.
CREATE TABLE IF NOT EXISTS review_session (
  id          SERIAL PRIMARY KEY,
  huddle_id   INTEGER REFERENCES signal(id),
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by  INTEGER NOT NULL REFERENCES actor(id),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_item (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES review_session(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  before_url  TEXT,
  after_url   TEXT,
  option_text TEXT NOT NULL DEFAULT '',
  decision    TEXT NOT NULL DEFAULT 'none' CHECK (decision IN ('none', 'done', 'rev', 'hold')),
  signal_id   INTEGER REFERENCES signal(id),  -- 확정 시 생성된 논의·결정(signal) 링크
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_item_session ON review_item(session_id, ord);

-- 코멘트를 review_item 에도 붙일 수 있게 (기존 signal 코멘트와 공존). signal_id 는 항목 코멘트에선 NULL.
ALTER TABLE comment ADD COLUMN IF NOT EXISTS review_item_id INTEGER REFERENCES review_item(id);
ALTER TABLE comment ALTER COLUMN signal_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comment_review_item ON comment(review_item_id);
