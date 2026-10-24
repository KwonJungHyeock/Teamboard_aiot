-- 회의실 — 같이 보고, 같이 정하고, 할 일로 (2026-10 회의실).
--
-- ── 무엇을 담나 ───────────────────────────────────────────────────
--
-- 영상 · 화면 공유는 **우리가 담지 않는다** — Jitsi 가 한다(지시: 「Jitsi 화면 내장」).
-- 우리가 담는 것은 회의가 끝나도 남아야 하는 것뿐이다: 누가 왔나 · 안건 · 공유한 링크 ·
-- 결정 · 할 일 · 회의록.
--
--   meeting           회의 하나. 열림(live) → 끝남(ended). Jitsi 방 이름은 추측 못 하게 무작위
--   meeting_attendee  들어온 사람 · 마지막으로 보인 때(2~3초마다 「여기 있다」를 보낸다)
--   meeting_item      안건 · 링크 · 결정 · 할 일 · 메모를 **한 표**에. 종류(kind)로 가른다
--
-- 결정은 기존 `decision` 표(0013)를 쓰지 않는다 — 그 표는 시그널(논의)에 매여 있어
-- (`discussion_id` 필수) 회의에서 바로 정한 것을 담을 자리가 없다. 회의의 결정은
-- 여기 남고, 회의록에 같이 실린다.
--
-- **팀 공개다.** 회의는 팀 것이라 팀원 누구나 보고 들어온다(비공개 회의를 만들지 않는다).
-- 팀 칸(team_id)은 0036 의 규칙대로 단다.
--
-- 되돌리기: db/migrations/rollback/0038_meeting_down.sql

CREATE TABLE IF NOT EXISTS meeting (
  id          SERIAL PRIMARY KEY,
  title       TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'live',
  room        TEXT        NOT NULL,
  started_by  INTEGER     NOT NULL REFERENCES actor(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  -- 끝낼 때 굳힌 회의록(안건 · 결정 · 할 일 · 링크 · 참석자). 끝난 뒤 바뀌지 않는다
  minutes     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE meeting DROP CONSTRAINT IF EXISTS meeting_status_check;
ALTER TABLE meeting ADD CONSTRAINT meeting_status_check CHECK (status IN ('live', 'ended'));
ALTER TABLE meeting DROP CONSTRAINT IF EXISTS meeting_title_check;
ALTER TABLE meeting ADD CONSTRAINT meeting_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_room ON meeting (room);
CREATE INDEX IF NOT EXISTS idx_meeting_recent ON meeting (status, started_at DESC);

CREATE TABLE IF NOT EXISTS meeting_attendee (
  meeting_id   INTEGER     NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  actor_id     INTEGER     NOT NULL REFERENCES actor(id),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, actor_id)
);
-- 「지금 회의 중인 사람」은 관제가 묻는다 — 사람별로 최근 것만
CREATE INDEX IF NOT EXISTS idx_meeting_attendee_seen ON meeting_attendee (actor_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS meeting_item (
  id          SERIAL PRIMARY KEY,
  meeting_id  INTEGER     NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  url         TEXT,
  -- 종류별 덧붙임: 안건 { done } · 결정 { votes: [actor], decidedAt } · 할 일 { taskId, assigneeId, due }
  meta        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  position    INTEGER     NOT NULL DEFAULT 0,
  created_by  INTEGER     NOT NULL REFERENCES actor(id),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE meeting_item DROP CONSTRAINT IF EXISTS meeting_item_kind_check;
ALTER TABLE meeting_item ADD CONSTRAINT meeting_item_kind_check
  CHECK (kind IN ('agenda', 'link', 'decision', 'action', 'note'));
ALTER TABLE meeting_item DROP CONSTRAINT IF EXISTS meeting_item_body_check;
ALTER TABLE meeting_item ADD CONSTRAINT meeting_item_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 1000);
CREATE INDEX IF NOT EXISTS idx_meeting_item ON meeting_item (meeting_id, kind, position, id) WHERE is_active;

-- 팀 칸 — 0036 과 같은 방식(id 를 읽어 기본값으로 건다)
DO $$
DECLARE
  t INTEGER;
BEGIN
  SELECT id INTO t FROM team WHERE key = 'aiot';
  IF t IS NULL THEN
    RAISE EXCEPTION '0038: team.key = aiot 행이 없다 — 0036 이 덜 돌았다';
  END IF;
  ALTER TABLE meeting ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id);
  EXECUTE format('ALTER TABLE meeting ALTER COLUMN team_id SET DEFAULT %s', t);
  EXECUTE format('UPDATE meeting SET team_id = %s WHERE team_id IS NULL', t);
  ALTER TABLE meeting ALTER COLUMN team_id SET NOT NULL;
END $$;
