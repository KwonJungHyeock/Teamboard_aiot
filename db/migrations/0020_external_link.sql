-- 외부 리소스 연결 (MD-P-2026-012, add-only)
-- Notion 전용 테이블을 만들지 않는다 — Figma·GitHub도 같은 자리에 붙는다.
-- 경계: 상태·일정·우선순위·진척은 Mission Deck에만 둔다. 여기에는 "링크와 메타"만 저장한다.
CREATE TABLE IF NOT EXISTS external_link (
  id             SERIAL PRIMARY KEY,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('task', 'project', 'goal', 'decision')),
  entity_id      INTEGER NOT NULL,
  provider       TEXT NOT NULL CHECK (provider IN ('notion', 'figma', 'github', 'other')),
  url            TEXT NOT NULL,
  title          TEXT,                                   -- 마지막으로 성공한 제목 (실패 시 이 값을 계속 쓴다)
  icon_url       TEXT,
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,     -- provider별 부가정보(최종 수정일·상태 등)
  last_synced_at TIMESTAMPTZ,                            -- 15분 캐시 기준
  created_by     INTEGER REFERENCES actor(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, url)
);

CREATE INDEX IF NOT EXISTS idx_external_link_entity ON external_link (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_external_link_provider ON external_link (provider, last_synced_at);
