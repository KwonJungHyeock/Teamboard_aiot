-- 협업 번들 (비파괴) — 이모지 리액션 · 알림 인박스 · 타임라인 공유 활동.
-- 논의 스레드 답글(reply)은 기존 comment 테이블을 재사용한다(신규 테이블 없음).

-- 이모지 리액션 — 답글/시그널/업무/활동에 토글. (사용자·대상·이모지) 유일.
CREATE TABLE IF NOT EXISTS reaction (
  id          SERIAL PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('reply', 'signal', 'task', 'activity')),
  target_id   INTEGER NOT NULL,
  emoji       TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES actor(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reaction_target ON reaction (target_type, target_id);

-- 알림 인박스 — @멘션·배정·답글·승인 필요·공유. read=false가 미확인.
CREATE TABLE IF NOT EXISTS notification (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES actor(id),        -- 받는 사람
  type       TEXT NOT NULL CHECK (type IN ('mention', 'assign', 'reply', 'approval', 'share')),
  ref_type   TEXT NOT NULL,                                 -- signal|task|activity
  ref_id     INTEGER,
  snippet    TEXT NOT NULL DEFAULT '',
  actor_id   INTEGER REFERENCES actor(id),                  -- 알림을 유발한 사람
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_user ON notification (user_id, read, created_at DESC);

-- 타임라인 공유 활동 포스트 — 업무 공유 등(팀 타임라인·알림 노출).
CREATE TABLE IF NOT EXISTS activity (
  id         SERIAL PRIMARY KEY,
  actor_id   INTEGER NOT NULL REFERENCES actor(id),
  kind       TEXT NOT NULL,                                 -- task_share|status ...
  ref_type   TEXT NOT NULL DEFAULT 'task',
  ref_id     INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity (created_at DESC);
