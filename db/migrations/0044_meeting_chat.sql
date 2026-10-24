-- 회의 채팅 · 파일 공유 (2026-10 리디자인 · 회의 패널).
--
-- 새 표를 만들지 않는다 — 회의 안의 글은 이미 `meeting_item`(0038)에 종류별로 쌓인다.
-- 종류 두 개를 더한다.
--   chat  채팅 한 줄. meta { reactions: { "👍": [actorId…] } }
--   file  올린 파일. url = 저장 위치, meta { name, size, mime, reactions }
-- 되돌리기: db/migrations/rollback/0044_meeting_chat_down.sql

ALTER TABLE meeting_item DROP CONSTRAINT IF EXISTS meeting_item_kind_check;
ALTER TABLE meeting_item ADD CONSTRAINT meeting_item_kind_check
  CHECK (kind IN ('agenda', 'link', 'decision', 'action', 'note', 'chat', 'file'));
CREATE INDEX IF NOT EXISTS idx_meeting_item_chat ON meeting_item (meeting_id, id) WHERE is_active AND kind IN ('chat', 'file');
