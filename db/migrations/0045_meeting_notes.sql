-- 회의록 쓰기 · 내 메모 (2026-10 운영 요청).
--
--   meeting.notes      회의 중 · 끝난 뒤에도 함께 쓰는 회의록 본문(자유 글).
--                      notes_rev 로 「내가 본 판」 위에만 저장한다 — 둘이 동시에 고치면 뒤에 저장한 쪽이
--                      남의 글을 덮지 않고 409 를 받는다(화면이 최신 판을 받아 다시 쓴다).
--   meeting_memo       회의마다 사람마다 하나 — 본인만 읽고 쓴다(팀장도 못 본다).
-- 되돌리기: db/migrations/rollback/0045_meeting_notes_down.sql

ALTER TABLE meeting ADD COLUMN IF NOT EXISTS notes     TEXT        NOT NULL DEFAULT '';
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS notes_rev INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS notes_by  INTEGER     REFERENCES actor(id);
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS notes_at  TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS meeting_memo (
  meeting_id INTEGER     NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  actor_id   INTEGER     NOT NULL REFERENCES actor(id),
  body       TEXT        NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, actor_id)
);
