-- 결정 로그 (MD-P-2026-004, 비파괴) — 논의를 "해결"하면 결정이 자동 기록된다.
-- 결정은 삭제 불가(감사 추적). 번복만 가능 — 기존 결정은 status='superseded' + superseded_by로 새 결정 연결.
-- status 값은 코드베이스 관례에 따라 영문 enum('confirmed'|'superseded'), 표기는 UI에서 확정/번복.
CREATE TABLE IF NOT EXISTS decision (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER REFERENCES project(id),
  discussion_id   INTEGER NOT NULL REFERENCES signal(id),   -- 원본 논의 (양방향 링크 필수)
  title           TEXT NOT NULL,                            -- 결정 내용 한 줄
  rationale       TEXT NOT NULL DEFAULT '',                 -- 근거·본문 (자동 프리필 후 사용자 수정)
  decided_by      INTEGER NOT NULL REFERENCES actor(id),
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed', 'superseded')),
  superseded_by   INTEGER REFERENCES decision(id),          -- 번복 시 새 결정
  linked_task_ids INTEGER[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_decision_project ON decision (project_id);
CREATE INDEX IF NOT EXISTS idx_decision_decided_at ON decision (decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_discussion ON decision (discussion_id);
