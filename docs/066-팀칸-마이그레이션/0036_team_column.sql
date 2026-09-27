-- MD-P-2026-066 §F — 팀 칸 하나 (`team_id`)
--
-- ⚠ **아직 승인 전이다.** 지시서 §F-54: 「마이그레이션 파일을 만들었으면 푸시 전에
--    멈추고 보고한다. 파일 내용을 그대로 보고에 적는다. 승인 뒤에 푸시한다.」
--    이 파일은 그래서 **커밋에 안 들어가 있다.**
--
-- ── 왜 지금 넣는가 ───────────────────────────────────────────────
--
-- 내년에 에듀이노 시스템으로 합친다. 그때 「이 줄이 어느 팀 것인가」가 없으면
-- 1년치를 한꺼번에 채워야 한다. 지금 넣으면 칸 하나다(§F).
--
-- ── 무엇을 하는가 ────────────────────────────────────────────────
--
--   ① `team` 표를 만든다 — id · key · name 셋뿐이다
--   ② `AIoT` 한 줄을 넣는다
--   ③ 네 표에 `team_id` 를 더한다 — task · goal · project · note
--   ④ 기존 줄을 전부 그 팀으로 채운다
--   ⑤ DEFAULT 를 걸고 NOT NULL 로 잠근다 — **새 줄도 비지 않는다**(§F-50)
--
-- **화면은 만들지 않는다**(§F-51). 팀 탭도, 팀 고르기도 없다. 이 파일은 칸만 만든다.
-- **소속 표(사용자 × 팀 × 역할)는 안 만든다**(§F-53) — 에듀이노 모양을 보고 정한다.
--
-- ── 「기록」을 `note` 로 읽었다 (판단한 자리) ────────────────────
--
-- 지시서의 넷은 「업무 · 목표 · 프로젝트 · 기록」이다. 앞의 셋은 표 이름이 그대로
-- 있는데 **「기록」은 이 제품에서 두 가지를 뜻한다**:
--
--   · `task.description` — v3 상세가 「기록」이라고 부르는 **칸**. 표가 아니다
--   · `note` (메모, 지금 0행) — 사람이 만드는 **독립된 줄**
--   · `task_comment`(6행) · `comment`(12행) — 사람이 적지만 **업무·시그널에 매달려
--     있다.** 부모 줄이 team_id 를 들고 있으므로 합칠 때 따라온다
--   · `activity_log`(217행) — **기계가 만든다.** 「사람이 만드는 줄」이 아니다
--
-- 그래서 합칠 때 **혼자 떠 있는 것**만 칸이 필요하다고 보고 `note` 를 골랐다.
-- 다르게 읽어야 하면 ③·④·⑤ 의 `note` 줄을 바꾸면 된다 — 한 줄씩이다.
--
-- ── 실행 전 확인 (§F-55 — 짐작하지 않고 실제 스키마를 읽었다) ────
--
--   · `team` 이라는 표·컬럼은 **없다.** 닮은 이름은 `event.is_team` 하나뿐이고
--     이 파일은 그걸 안 건드린다
--     (information_schema.columns 전량 조회 · 2026-09-27 로컬)
--   · 네 표의 PK 는 전부 `id` (integer, serial) 다
--   · `note` 는 `owner_actor_id` · `title` · `body`(jsonb) · `is_active` ·
--     `created_at` · `updated_at` 을 갖는다. `team_id` 라는 이름은 비어 있다
--   · 행 수 — task 44 · goal 7 · project 9 · note 0 (로컬)
--
-- ── 러너가 이 파일에서 멈추면 어떻게 되는가 ──────────────────────
--
-- 0031·0035 의 자리다 — 러너가 실패하면 그 뒤 전 요청이 500 이 된다(§F-55).
-- 그래서 이 파일은 **비파괴만** 한다: CREATE TABLE IF NOT EXISTS ·
-- ADD COLUMN IF NOT EXISTS · UPDATE · SET DEFAULT · SET NOT NULL.
-- 지우는 문장이 없다. 두 번 돌려도 같은 결과다(멱등).
--
-- DEFAULT 값을 **숫자로 박지 않는다.** `team` 의 id 는 serial 이라 환경마다 다를
-- 수 있고, 1 이라고 박으면 다른 환경에서 조용히 틀린 팀을 가리킨다 —
-- `area` 의 id 를 코드에 박을 수 없었던 것과 같은 이유다(043 §1).
-- 그래서 id 를 읽어서 ALTER 문을 만든다.
--
-- 되돌리기: db/migrations/rollback/0036_team_column_down.sql
--   ⚠ 되돌리기는 **컬럼 넷과 표 하나를 지운다.** 채워 둔 팀 값이 통째로 사라진다.

-- ① 팀 표 — 셋뿐이다. 소속·역할은 여기 없다(§F-53)
CREATE TABLE IF NOT EXISTS team (
  id         SERIAL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ② AIoT 한 줄. `key` 는 사람이 안 바꾸는 이름이고 `name` 은 화면에 쓸 이름이다
INSERT INTO team (key, name) VALUES ('aiot', 'AIoT')
  ON CONFLICT (key) DO NOTHING;

-- ③ 칸을 더한다 — **비파괴.** 이미 있으면 아무 일도 안 일어난다
ALTER TABLE task    ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id);
ALTER TABLE goal    ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id);
ALTER TABLE project ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id);
ALTER TABLE note    ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES team(id);

-- ④⑤ 기존 줄을 채우고 · DEFAULT 를 걸고 · NOT NULL 로 잠근다
DO $$
DECLARE
  t INTEGER;
  tbl TEXT;
BEGIN
  SELECT id INTO t FROM team WHERE key = 'aiot';
  -- 없으면 **여기서 멈춘다.** 조용히 넘어가면 NOT NULL 을 걸 때 죽고,
  -- 그때는 무엇이 없어서 죽었는지가 안 보인다.
  IF t IS NULL THEN
    RAISE EXCEPTION '0036: team.key = aiot 행이 없다 — ② 의 INSERT 가 안 들어갔다';
  END IF;

  FOREACH tbl IN ARRAY ARRAY['task', 'goal', 'project', 'note'] LOOP
    EXECUTE format('UPDATE %I SET team_id = %s WHERE team_id IS NULL', tbl, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET DEFAULT %s', tbl, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET NOT NULL', tbl);
  END LOOP;
END $$;

-- 합칠 때 팀으로 훑는다. 네 표 다 같은 모양의 색인을 둔다
CREATE INDEX IF NOT EXISTS idx_task_team    ON task(team_id);
CREATE INDEX IF NOT EXISTS idx_goal_team    ON goal(team_id);
CREATE INDEX IF NOT EXISTS idx_project_team ON project(team_id);
CREATE INDEX IF NOT EXISTS idx_note_team    ON note(team_id);
