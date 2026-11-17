-- 회의 모드 개선 (2026-11-17) — 「모두에게 띄우기」: 지금 회의에서 함께 보는 자료 하나.
--
--   누가 자료(파일 · 링크)를 띄우면 다른 참석자 화면이 따라간다(3초 묻기). 띄운 사람이 거두거나
--   다른 자료를 띄우면 바뀐다. 그 항목을 내리면 함께 보기도 풀린다(읽을 때 살아 있는 항목만 본다).
-- 되돌리기: db/migrations/rollback/0049_meeting_present_down.sql

ALTER TABLE meeting ADD COLUMN IF NOT EXISTS present_item_id INTEGER REFERENCES meeting_item(id);
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS present_by INTEGER REFERENCES actor(id);
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS present_at TIMESTAMPTZ;
