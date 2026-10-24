-- 하루 한 줄 · 상태 — 사람마다 하루 한 행 (2026-10 스탠드업 · 상태 표시).
--
-- ── 무엇인가 ─────────────────────────────────────────────────────
--
--   line   「오늘 할 일」 한 줄. 아침에 적는다. 관제 「지금 팀」에 그 사람 밑에 뜬다
--   state  지금 어떤가 — 집중(focus) · 외근(out) · 휴가(off). 비우면 「보통」
--
-- 「회의 중」은 여기 없다 — 회의실에 들어와 있으면 저절로 뜬다(0038 `inMeetingNow`).
-- 사람이 고르는 상태와 시스템이 아는 상태를 섞지 않는다.
--
-- ── 누가 보나 ─────────────────────────────────────────────────────
--
-- **팀 공개다.** 「내 기록」(0037 · 나만 봄)과 일부러 다른 표다. 내 기록에 스탠드업을
-- 넣으면 「나만 본다」는 약속이 깨진다. 적는 칸에 「팀이 봅니다」를 적는다.
-- 고치는 것은 본인만 한다.
--
-- ── 하루 ─────────────────────────────────────────────────────────
-- `day` 는 서울 날짜다. 어제 줄은 오늘 안 뜬다(지난 줄은 남아 있다 — 지우지 않는다).
--
-- 팀 칸(team_id)은 0036 의 규칙대로 단다.
-- 되돌리기: db/migrations/rollback/0039_daily_note_down.sql

CREATE TABLE IF NOT EXISTS daily_note (
  actor_id    INTEGER     NOT NULL REFERENCES actor(id),
  day         DATE        NOT NULL,
  line        TEXT,
  state       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, day)
);
ALTER TABLE daily_note DROP CONSTRAINT IF EXISTS daily_note_state_check;
ALTER TABLE daily_note ADD CONSTRAINT daily_note_state_check CHECK (state IS NULL OR state IN ('focus', 'out', 'off'));
ALTER TABLE daily_note DROP CONSTRAINT IF EXISTS daily_note_line_check;
ALTER TABLE daily_note ADD CONSTRAINT daily_note_line_check CHECK (line IS NULL OR length(btrim(line)) BETWEEN 1 AND 200);
CREATE INDEX IF NOT EXISTS idx_daily_note_day ON daily_note (day);

DO $$
DECLARE
  t INTEGER;
BEGIN
  SELECT id INTO t FROM team WHERE key = 'aiot';
  IF t IS NULL THEN
    RAISE EXCEPTION '0039: team.key = aiot 행이 없다 — 0036 이 덜 돌았다';
  END IF;
  ALTER TABLE daily_note ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id);
  EXECUTE format('ALTER TABLE daily_note ALTER COLUMN team_id SET DEFAULT %s', t);
  EXECUTE format('UPDATE daily_note SET team_id = %s WHERE team_id IS NULL', t);
  ALTER TABLE daily_note ALTER COLUMN team_id SET NOT NULL;
END $$;
