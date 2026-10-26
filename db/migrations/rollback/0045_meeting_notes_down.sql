-- 0045 되돌리기 — 회의록 본문 · 내 메모가 사라진다(되살릴 수 없다).
DROP TABLE IF EXISTS meeting_memo;
ALTER TABLE meeting DROP COLUMN IF EXISTS notes_at;
ALTER TABLE meeting DROP COLUMN IF EXISTS notes_by;
ALTER TABLE meeting DROP COLUMN IF EXISTS notes_rev;
ALTER TABLE meeting DROP COLUMN IF EXISTS notes;
