-- 팀 보고(월간 · 분기 · 연간) — 「보고」 탭 (2026-10-30 지시서).
--
-- 기존 업무 · 목표 · 회의 · 일정 표는 건드리지 않는다. 보고는 업무를 **가리키기만** 한다(task_id).
-- 지우기는 전부 소프트(is_active=false). 숫자는 서버가 업무 · 목표에서 센다 — 여기에는 사람이 쓴 글만 둔다.
-- 확정하면 그때의 집계를 snapshot 에 굳힌다(이후 업무를 고쳐도 확정 보고의 숫자는 그대로).
-- 개인 「월간 보고」(0042 monthly_report)와는 다른 것이다 — 그쪽은 사람마다 쓰는 기록이다.
-- 되돌리기: db/migrations/rollback/0047_team_report_down.sql

CREATE TABLE IF NOT EXISTS team_report (
  id            SERIAL PRIMARY KEY,
  kind          TEXT        NOT NULL CHECK (kind IN ('month', 'quarter', 'year')),
  period_start  DATE        NOT NULL,
  period_end    DATE        NOT NULL,
  title         TEXT        NOT NULL DEFAULT '',
  status        TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  -- 파트 순서 — ["platform","rnd","etc"] 의 순열. 만들 때 팀 기본값(config report_part_order)을 복사한다
  part_order    JSONB       NOT NULL DEFAULT '["platform","rnd","etc"]',
  -- ① 목표 달성률 옆의 핵심 멘트
  headline      TEXT        NOT NULL DEFAULT '',
  snapshot      JSONB,
  pdf_path      TEXT,
  finalized_at  TIMESTAMPTZ,
  finalized_by  INTEGER     REFERENCES actor(id),
  created_by    INTEGER     NOT NULL REFERENCES actor(id),
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
-- 같은 종류 · 같은 기간의 살아 있는 보고는 하나
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_report_period ON team_report (kind, period_start) WHERE is_active;

-- 보고 항목 — 팀보드 업무 1건 ↔ 보고 1건. 팀보드에 없는 업무는 넣을 수 없다(task_id 필수)
CREATE TABLE IF NOT EXISTS team_report_item (
  id          SERIAL PRIMARY KEY,
  report_id   INTEGER     NOT NULL REFERENCES team_report(id) ON DELETE CASCADE,
  task_id     INTEGER     NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  summary     TEXT        NOT NULL DEFAULT '',   -- 간단 설명 2~3줄
  comment     TEXT        NOT NULL DEFAULT '',   -- 핵심 멘트 1~2문장
  visible     BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_report_item_task ON team_report_item (report_id, task_id) WHERE is_active;

-- 에셋 슬롯 — 이미지 · GIF · 영상은 올린 파일(path), iframe 은 주소(url). 코드로 그리는 그림은 없다
CREATE TABLE IF NOT EXISTS team_report_asset (
  id          SERIAL PRIMARY KEY,
  item_id     INTEGER     NOT NULL REFERENCES team_report_item(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('image', 'gif', 'video', 'iframe')),
  path        TEXT,
  url         TEXT,
  caption     TEXT        NOT NULL DEFAULT '',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ⑤ 결정 · 요청 사항 — 업무와 별개
CREATE TABLE IF NOT EXISTS team_report_request (
  id          SERIAL PRIMARY KEY,
  report_id   INTEGER     NOT NULL REFERENCES team_report(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('decide', 'confirm', 'coop', 'tidy')),
  body        TEXT        NOT NULL DEFAULT '',
  due_date    DATE,
  requester   TEXT        NOT NULL DEFAULT '',   -- 요청 (누가 · 누구에게)
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'hold')),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ⑥ 핵심 이슈 — 분기 · 연간 보고에만
CREATE TABLE IF NOT EXISTS team_report_issue (
  id          SERIAL PRIMARY KEY,
  report_id   INTEGER     NOT NULL REFERENCES team_report(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL DEFAULT '',
  background  TEXT        NOT NULL DEFAULT '',   -- 배경 · 현황
  alt_a       TEXT        NOT NULL DEFAULT '',
  alt_b       TEXT        NOT NULL DEFAULT '',
  discussion  TEXT        NOT NULL DEFAULT '',   -- 논의 포인트
  decision    TEXT        NOT NULL DEFAULT '',   -- 결정 결과
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_report_action (
  id          SERIAL PRIMARY KEY,
  issue_id    INTEGER     NOT NULL REFERENCES team_report_issue(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL DEFAULT '',
  assignee_id INTEGER     REFERENCES actor(id),
  due_date    DATE,
  status      TEXT        NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ⑦ 다음 기간 계획 — 수기 추가분(기한이 다음 기간인 업무는 자동으로 붙는다). 다음 보고가 「지난 계획」으로 불러온다
CREATE TABLE IF NOT EXISTS team_report_plan (
  id          SERIAL PRIMARY KEY,
  report_id   INTEGER     NOT NULL REFERENCES team_report(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'dropped')),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
