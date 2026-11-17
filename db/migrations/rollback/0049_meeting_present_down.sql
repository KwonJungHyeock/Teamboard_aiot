-- 롤백: 0049 — 함께 보기 칸을 지운다(자료 · 채팅은 그대로).
ALTER TABLE meeting DROP COLUMN IF EXISTS present_at;
ALTER TABLE meeting DROP COLUMN IF EXISTS present_by;
ALTER TABLE meeting DROP COLUMN IF EXISTS present_item_id;
