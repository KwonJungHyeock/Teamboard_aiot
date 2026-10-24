-- 롤백: 회의 채팅 (0044_meeting_chat.sql)
-- ⚠️ 채팅 · 파일 행을 먼저 지워야 제약을 되돌릴 수 있다.
DELETE FROM meeting_item WHERE kind IN ('chat', 'file');
DROP INDEX IF EXISTS idx_meeting_item_chat;
ALTER TABLE meeting_item DROP CONSTRAINT IF EXISTS meeting_item_kind_check;
ALTER TABLE meeting_item ADD CONSTRAINT meeting_item_kind_check
  CHECK (kind IN ('agenda', 'link', 'decision', 'action', 'note'));
