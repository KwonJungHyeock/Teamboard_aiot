-- 업무기록 — 각자 한 줄씩 적고, 각자 만든 카테고리로 나눈다 (2026-10 업무기록).
--
-- ── 무엇인가 ─────────────────────────────────────────────────────
--
-- 「오늘 한 일 한 줄」이다. 업무(task)가 아니다 — 업무는 할 일이고, 기록은 한 일이다.
-- 업무에 걸 수는 있지만(task_id) 안 걸어도 된다. 걸어야만 적을 수 있으면 적지 않는다.
--
-- ── 누구 것인가 ───────────────────────────────────────────────────
--
-- **항상 쓴 사람 것이다.** 개인 메모(0026)와 같은 판단이다 — 공개 스위치를 두면
-- 다시 「이걸 올리면 남들이 보나?」를 따져야 하고, 그게 적는 속도를 늦춘다.
-- 팀에 보이는 것은 사람이 「월간 정리」로 골라 보낼 때뿐이다(다음 회차).
--
-- ── 카테고리도 각자 것이다 ────────────────────────────────────────
--
-- 영역(area) 일곱은 팀의 분류라 사람이 못 만든다. 기록의 분류는 사람마다 다르다
-- (「학생 페이지」 「Thonny 전환」). 그래서 따로 둔다. 지우면 숨긴다(is_active) —
-- 그 카테고리로 적은 기록이 이름 없는 기록이 되면 안 된다.
--
-- ── 파일 ─────────────────────────────────────────────────────────
--
-- 첨부는 이 행의 `attachments`(JSONB 배열)에 pathname 으로만 남는다. 파일 자체는
-- 비공개 Blob 의 `worklog/{쓴 사람}/…` 아래에 있다 — 공개 URL 을 저장하지 않는다(014a).
--
-- 팀 칸(team_id)은 0036 의 규칙대로 단다: NOT NULL · 기본값 aiot.
--
-- 되돌리기: db/migrations/rollback/0037_work_log_down.sql

CREATE TABLE IF NOT EXISTS work_log_category (
  id             SERIAL PRIMARY KEY,
  owner_actor_id INTEGER     NOT NULL REFERENCES actor(id),
  name           TEXT        NOT NULL,
  color          TEXT        NOT NULL DEFAULT '#2348B8',
  sort           INTEGER     NOT NULL DEFAULT 0,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 이름이 비면 칩이 빈 동그라미가 된다. 길면 칩이 줄을 넘는다.
ALTER TABLE work_log_category DROP CONSTRAINT IF EXISTS work_log_category_name_check;
ALTER TABLE work_log_category ADD CONSTRAINT work_log_category_name_check
  CHECK (length(btrim(name)) BETWEEN 1 AND 30);
-- 한 사람 안에서 살아 있는 같은 이름은 하나 — 「#학생페이지」를 칠 때마다 새로 생기면 안 된다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_log_category_owner_name
  ON work_log_category (owner_actor_id, lower(btrim(name))) WHERE is_active;

CREATE TABLE IF NOT EXISTS work_log (
  id             SERIAL PRIMARY KEY,
  owner_actor_id INTEGER     NOT NULL REFERENCES actor(id),
  -- 「언제 한 일인가」. 적은 시각(created_at)과 다를 수 있다 — 어제 일을 오늘 적는다.
  logged_on      DATE        NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  body           TEXT        NOT NULL,
  category_id    INTEGER     REFERENCES work_log_category(id),
  task_id        INTEGER     REFERENCES task(id),
  attachments    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE work_log DROP CONSTRAINT IF EXISTS work_log_body_check;
ALTER TABLE work_log ADD CONSTRAINT work_log_body_check
  CHECK (length(btrim(body)) BETWEEN 1 AND 2000);
ALTER TABLE work_log DROP CONSTRAINT IF EXISTS work_log_attachments_check;
ALTER TABLE work_log ADD CONSTRAINT work_log_attachments_check
  CHECK (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 10);
-- 읽는 길은 「내 기록, 이 달, 최근 순」 하나다.
CREATE INDEX IF NOT EXISTS idx_work_log_owner_day
  ON work_log (owner_actor_id, logged_on DESC, id DESC) WHERE is_active;

-- 팀 칸 — 0036 과 같은 방식(id 를 읽어 기본값으로 건다)
DO $$
DECLARE
  t   INTEGER;
  tbl TEXT;
BEGIN
  SELECT id INTO t FROM team WHERE key = 'aiot';
  IF t IS NULL THEN
    RAISE EXCEPTION '0037: team.key = aiot 행이 없다 — 0036 이 덜 돌았다';
  END IF;
  FOREACH tbl IN ARRAY ARRAY['work_log_category', 'work_log'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id)', tbl);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET DEFAULT %s', tbl, t);
    -- 새 표라 비어 있다. 혹시 손으로 넣은 줄이 있으면 채우고 잠근다.
    EXECUTE format('UPDATE %I SET team_id = %s WHERE team_id IS NULL', tbl, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET NOT NULL', tbl);
  END LOOP;
END $$;
