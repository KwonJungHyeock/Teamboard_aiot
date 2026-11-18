-- 롤백: 0050 — 요청 표를 지우고, 「긴급」은 「높음」으로 돌린 뒤 우선순위 셋으로 되돌린다.
DROP TABLE IF EXISTS task_request;
UPDATE task SET priority = 'high' WHERE priority = 'urgent';
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_priority_check;
ALTER TABLE task ADD CONSTRAINT task_priority_check CHECK (priority IN ('high', 'mid', 'low'));
