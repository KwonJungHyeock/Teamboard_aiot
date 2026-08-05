-- 업무 문서 본문 (MD-P-2026-019 §F, add-only)
-- 기존 task.description(평문)은 남겨두고, 블록 문서를 doc 에 따로 담는다.
-- 캔버스(project_canvas.blocks)와 같은 블록 모델을 쓴다 — 새 구조를 만들지 않는다.
-- doc_updated_at 은 캔버스와 동일한 baseUpdatedAt 낙관적 동시성에 쓴다.
ALTER TABLE task ADD COLUMN IF NOT EXISTS doc JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE task ADD COLUMN IF NOT EXISTS doc_updated_at TIMESTAMPTZ;
ALTER TABLE task ADD COLUMN IF NOT EXISTS doc_updated_by INTEGER REFERENCES actor(id);
