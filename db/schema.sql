-- 팀보드 (TeamBoard) 스키마 — PRD 8장 데이터 모델

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('lead', 'member')),
  notion_user_id TEXT,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 부사수 설정 (1 user : 1 assistant)
CREATE TABLE IF NOT EXISTS assistants (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER UNIQUE NOT NULL REFERENCES users(id),
  name                TEXT NOT NULL DEFAULT '부사수',
  report_style        TEXT NOT NULL DEFAULT 'brief' CHECK (report_style IN ('brief', 'detailed')),
  work_areas          JSONB NOT NULL DEFAULT '[]',
  auto_scope          TEXT NOT NULL DEFAULT 'own',
  system_prompt_extra TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 초안 / 승인 상태 (승인 게이트의 핵심)
CREATE TABLE IF NOT EXISTS drafts (
  id             SERIAL PRIMARY KEY,
  assistant_id   INTEGER NOT NULL REFERENCES assistants(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  task_type      TEXT NOT NULL CHECK (task_type IN ('자료조사', '회의록', '내용정리', '반복업무')),
  instruction    TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'working'
                 CHECK (status IN ('working', 'pending', 'approved', 'rejected', 'failed')),
  feedback       TEXT,
  rework_of      INTEGER REFERENCES drafts(id),
  approver_id    INTEGER REFERENCES users(id),
  notion_page_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_drafts_user_status ON drafts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);

-- 실시간 활동 로그 (감사 추적)
CREATE TABLE IF NOT EXISTS activity_log (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  assistant_id INTEGER REFERENCES assistants(id),
  message      TEXT NOT NULL,
  level        TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warn', 'error')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

-- 시스템 설정 (팀장만 수정) — Notion 연동 범위 등
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
