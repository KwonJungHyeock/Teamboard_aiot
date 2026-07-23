-- 팀보드 스키마 v1.0 — docs/SPEC.md 5장 기준 (D-017: 운영 전환 전 스키마 확정)
-- 삭제는 소프트 삭제(is_active=false). 하드 삭제 없음.

-- ─── Actor 모델 (SPEC 2.5): 사람과 부사수를 actor 하나로 통합 ───

CREATE TABLE IF NOT EXISTS actor (
  id             SERIAL PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('human', 'agent')),
  display_name   TEXT NOT NULL,
  short_name     TEXT,                           -- 호칭용 (예: 정혁). 없으면 display_name 사용
  owner_actor_id INTEGER REFERENCES actor(id),  -- agent일 때 소유자(human)
  avatar_url     TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기존 DB 업그레이드 (idempotent)
ALTER TABLE actor ADD COLUMN IF NOT EXISTS short_name TEXT;

CREATE TABLE IF NOT EXISTS account (
  actor_id       INTEGER PRIMARY KEY REFERENCES actor(id),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('lead', 'member', 'viewer')),
  must_change_pw BOOLEAN NOT NULL DEFAULT false,
  notion_user_id TEXT,                           -- Notion 담당자(person) 매핑용
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_config (
  actor_id            INTEGER PRIMARY KEY REFERENCES actor(id),
  report_style        TEXT NOT NULL DEFAULT 'brief' CHECK (report_style IN ('brief', 'detailed')),
  work_areas          JSONB NOT NULL DEFAULT '[]',
  auto_scope          TEXT NOT NULL DEFAULT 'own',
  system_prompt_extra TEXT NOT NULL DEFAULT '',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 코어 객체 5종 (SPEC 2.1): Goal ← Task → Project → Artifact, Signal은 어디에나 ───

CREATE TABLE IF NOT EXISTS project (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'hold')),
  start_date DATE,
  end_date   DATE,
  color_key  TEXT,                               -- 'edu' | 'play' | 'train' (theme.css 토큰 키)
  notion_url TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기존 DB 보강 (CREATE TABLE IF NOT EXISTS는 기존 테이블에 제약을 추가하지 않음)
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_status_check;
ALTER TABLE project ADD CONSTRAINT project_status_check CHECK (status IN ('active', 'done', 'hold'));

CREATE TABLE IF NOT EXISTS goal (
  id             SERIAL PRIMARY KEY,
  parent_id      INTEGER REFERENCES goal(id),
  period_type    TEXT NOT NULL CHECK (period_type IN ('year', 'quarter', 'month')),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  target_metric  TEXT,
  target_value   NUMERIC,
  current_value  NUMERIC,
  progress_mode  TEXT NOT NULL DEFAULT 'auto' CHECK (progress_mode IN ('auto', 'manual')),
  progress       NUMERIC NOT NULL DEFAULT 0,
  owner_actor_id INTEGER REFERENCES actor(id),
  project_id     INTEGER REFERENCES project(id),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER REFERENCES project(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo'
               CHECK (status IN ('proposed', 'todo', 'doing', 'review', 'done', 'dropped')),
  assignee_id  INTEGER REFERENCES actor(id),
  due_date     DATE,
  priority     TEXT NOT NULL DEFAULT 'mid' CHECK (priority IN ('high', 'mid', 'low')),
  origin       TEXT NOT NULL DEFAULT 'human' CHECK (origin IN ('human', 'agent')),
  created_by   INTEGER REFERENCES actor(id),
  completed_at TIMESTAMPTZ,
  drop_reason  TEXT,                              -- status='dropped' 전환 시 필수 (진척률 우회 방지)
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE task ADD COLUMN IF NOT EXISTS drop_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_task_assignee ON task(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_task_due ON task(due_date);

CREATE TABLE IF NOT EXISTS goal_task (
  goal_id INTEGER NOT NULL REFERENCES goal(id),
  task_id INTEGER NOT NULL REFERENCES task(id),
  PRIMARY KEY (goal_id, task_id)
);

CREATE TABLE IF NOT EXISTS event (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES project(id),
  title      TEXT NOT NULL,
  start_at   TIMESTAMPTZ NOT NULL,
  end_at     TIMESTAMPTZ NOT NULL,
  is_team    BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES actor(id),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_start ON event(start_at);

CREATE TABLE IF NOT EXISTS event_participant (
  event_id INTEGER NOT NULL REFERENCES event(id),
  actor_id INTEGER NOT NULL REFERENCES actor(id),
  PRIMARY KEY (event_id, actor_id)
);

CREATE TABLE IF NOT EXISTS artifact (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER REFERENCES project(id),
  kind                TEXT NOT NULL CHECK (kind IN ('notion', 'github', 'figma', 'file', 'link')),
  title               TEXT NOT NULL,
  url                 TEXT NOT NULL,
  external_updated_at TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_artifact (
  task_id     INTEGER NOT NULL REFERENCES task(id),
  artifact_id INTEGER NOT NULL REFERENCES artifact(id),
  PRIMARY KEY (task_id, artifact_id)
);

-- ─── Signal 4타입 + 허들(scope) (SPEC 2.3, 2.4) ───

CREATE TABLE IF NOT EXISTS signal (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('decision', 'review', 'memo', 'risk')),
  scope       TEXT NOT NULL DEFAULT 'team' CHECK (scope IN ('private', 'huddle', 'team')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  author_id   INTEGER NOT NULL REFERENCES actor(id),
  project_id  INTEGER REFERENCES project(id),
  task_id     INTEGER REFERENCES task(id),
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'discussing', 'resolved', 'archived')),
  resolved_at TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_status ON signal(status, type);

CREATE TABLE IF NOT EXISTS comment (
  id         SERIAL PRIMARY KEY,
  signal_id  INTEGER NOT NULL REFERENCES signal(id),
  author_id  INTEGER NOT NULL REFERENCES actor(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 부사수 초안 / 승인 게이트 (기존 유지 + monthly_report 확장, FK만 actor로) ───

CREATE TABLE IF NOT EXISTS drafts (
  id             SERIAL PRIMARY KEY,
  assistant_id   INTEGER NOT NULL REFERENCES actor(id),  -- type='agent'
  user_id        INTEGER NOT NULL REFERENCES actor(id),  -- type='human'
  task_type      TEXT NOT NULL CHECK (task_type IN ('자료조사', '회의록', '내용정리', '반복업무', 'monthly_report')),
  instruction    TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'working'
                 CHECK (status IN ('working', 'pending', 'approved', 'rejected', 'failed')),
  feedback       TEXT,
  rework_of      INTEGER REFERENCES drafts(id),
  approver_id    INTEGER REFERENCES actor(id),
  notion_page_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_drafts_user_status ON drafts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);

-- ─── 월간 보고 (SPEC 3장) ───

CREATE TABLE IF NOT EXISTS report (
  id             SERIAL PRIMARY KEY,
  period_year    INTEGER NOT NULL,
  period_month   INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  draft_id       INTEGER REFERENCES drafts(id),
  content        JSONB NOT NULL DEFAULT '{}',    -- 서버 집계 JSON 원본 (D-013)
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approved_by    INTEGER REFERENCES actor(id),
  notion_page_id TEXT,
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_period ON report(period_year, period_month);

-- ─── 감사 로그 (기존 유지, FK만 actor로) ───

CREATE TABLE IF NOT EXISTS activity_log (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES actor(id),
  assistant_id INTEGER REFERENCES actor(id),
  message      TEXT NOT NULL,
  level        TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warn', 'error')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

-- ─── 시스템 설정 (app_settings → config 개명) ───

CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES actor(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
