-- 월간 보고(개인) — 내 기록 · 끝낸 업무로 한 달을 정리해 팀장에게 낸다 (2026-10 월간 보고).
--
-- ── 무엇인가 ─────────────────────────────────────────────────────
--
-- 사람 한 명 · 달 하나에 보고 한 편. 「내 기록」(0037)의 「다음 회차」로 미뤄 둔 그것이다.
-- 기존 `report` 표(0001)는 **팀 전체** 월간 보고(팀장이 만든다)라 다른 것이다 — 섞지 않는다.
--
--   status   draft(쓰는 중 · 나만 봄) → submitted(팀장에게 냄)
--   body     마크다운 글. AI 초안으로 시작해도 사람이 고친 것이 남는다
--   lead_*   팀장이 확인한 때 · 한 줄 코멘트
--
-- ── 누가 보나 ─────────────────────────────────────────────────────
-- 쓰는 중에는 **나만.** 낸 뒤에는 팀장 · 관리자도 본다. 되돌리면(withdraw) 다시 나만.
--
-- 팀 칸(team_id)은 0036 의 규칙대로 단다.
-- 되돌리기: db/migrations/rollback/0042_monthly_report_down.sql

CREATE TABLE IF NOT EXISTS monthly_report (
  id             SERIAL PRIMARY KEY,
  actor_id       INTEGER     NOT NULL REFERENCES actor(id),
  month          TEXT        NOT NULL,
  body           TEXT        NOT NULL DEFAULT '',
  status         TEXT        NOT NULL DEFAULT 'draft',
  ai_at          TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  lead_read_by   INTEGER     REFERENCES actor(id),
  lead_read_at   TIMESTAMPTZ,
  lead_comment   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE monthly_report DROP CONSTRAINT IF EXISTS monthly_report_status_check;
ALTER TABLE monthly_report ADD CONSTRAINT monthly_report_status_check CHECK (status IN ('draft', 'submitted'));
ALTER TABLE monthly_report DROP CONSTRAINT IF EXISTS monthly_report_month_check;
ALTER TABLE monthly_report ADD CONSTRAINT monthly_report_month_check CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE monthly_report DROP CONSTRAINT IF EXISTS monthly_report_body_check;
ALTER TABLE monthly_report ADD CONSTRAINT monthly_report_body_check CHECK (length(body) <= 20000);
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_report ON monthly_report (actor_id, month);
CREATE INDEX IF NOT EXISTS idx_monthly_report_month ON monthly_report (month, status);

DO $$
DECLARE
  t INTEGER;
BEGIN
  SELECT id INTO t FROM team WHERE key = 'aiot';
  IF t IS NULL THEN
    RAISE EXCEPTION '0042: team.key = aiot 행이 없다 — 0036 이 덜 돌았다';
  END IF;
  ALTER TABLE monthly_report ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id);
  EXECUTE format('ALTER TABLE monthly_report ALTER COLUMN team_id SET DEFAULT %s', t);
  EXECUTE format('UPDATE monthly_report SET team_id = %s WHERE team_id IS NULL', t);
  ALTER TABLE monthly_report ALTER COLUMN team_id SET NOT NULL;
END $$;
