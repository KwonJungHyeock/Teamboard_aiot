-- 활동 인박스 고도화 (MD-P-2026-007, 비파괴)
-- 새 알림 "종류"를 만들지 않는다. 기존에 화면에서 파생으로 보여주던 마감(deadline/overdue)을
-- 저장 대상으로 옮겨 중복 발송을 원천 차단하고, 분류·묶음·음소거·저장된 뷰에 필요한 열만 더한다.

-- 1) 중복 방지 키 — 같은 사건은 사용자당 한 줄만 존재한다.
ALTER TABLE notification ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_dedupe
  ON notification (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 2) 답글 묶음 — "답글 3개"로 한 줄에 합쳐 표시한다.
ALTER TABLE notification ADD COLUMN IF NOT EXISTS bundle_count INTEGER NOT NULL DEFAULT 1;

-- 3) 보관 — 삭제가 아니라 목록에서 내린다(일괄 처리 [보관]).
ALTER TABLE notification ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

-- 4) 마감 알림을 저장 가능하게. 화면이 이미 쓰던 표시 타입을 그대로 옮긴 것이며
--    알림 종류가 늘어나는 것은 아니다(파생 → 저장).
ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_type_check;
ALTER TABLE notification ADD CONSTRAINT notification_type_check
  CHECK (type IN ('mention', 'assign', 'reply', 'approval', 'share', 'deadline', 'overdue'));

CREATE INDEX IF NOT EXISTS idx_notification_inbox
  ON notification (user_id, archived, created_at DESC);

-- 5) 저장된 뷰 — 현재 필터 조합에 이름을 붙여 필터 레일 하단에 고정.
CREATE TABLE IF NOT EXISTS saved_view (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES actor(id),
  name       TEXT NOT NULL,
  filter     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { kind, channel, unreadOnly }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_saved_view_user ON saved_view (user_id, created_at);

-- 6) 음소거 — scope 'all'(임시, until 필수) · 'project:12'(해제 전까지).
CREATE TABLE IF NOT EXISTS notification_mute (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES actor(id),
  scope      TEXT NOT NULL,
  until      TIMESTAMPTZ,                            -- NULL = 해제 전까지
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope)
);
