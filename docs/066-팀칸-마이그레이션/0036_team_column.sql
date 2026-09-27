-- MD-P-2026-066 §F · 067 §E — 팀 칸 하나 (`team_id`)
--
-- ⚠ **아직 승인 전이다.** 이 파일은 `docs/` 에 있고 러너는 여기를 안 본다.
--    승인 뒤에 `db/migrations/0036_team_column.sql` 로 옮긴다(§E-30).
--
-- ── 왜 지금 넣는가 ───────────────────────────────────────────────
--
-- 내년에 에듀이노 시스템으로 합친다. 그때 「이 줄이 어느 팀 것인가」가 없으면
-- 1년치를 한꺼번에 채워야 한다. 지금 넣으면 칸 하나다.
--
-- ── 무엇을 하는가 ────────────────────────────────────────────────
--
--   ① `team` 표를 만든다 — id · key · name 셋뿐이다
--   ② `AIoT` 한 줄을 넣는다
--   ③ 열두 표에 `team_id` 를 더한다
--   ④ 기존 줄을 전부 그 팀으로 채운다 — **UPDATE 없이**(트리거를 안 돌린다)
--   ⑤ DEFAULT 를 걸고 NOT NULL 로 잠근다 — **새 줄도 비지 않는다**
--
-- **화면은 만들지 않는다.** 팀 탭도, 팀 고르기도 없다.
-- **소속 표(사용자 × 팀 × 역할)는 안 만든다** — 에듀이노 모양을 보고 정한다.
--
-- ── 어느 표인가 — 067 §E-1 의 **기준으로** 찾았다 ────────────────
--
-- 066 에서는 지시서가 준 넷(업무 · 목표 · 프로젝트 · 기록)만 넣었다. 067 §E-24:
-- 「목록을 받아 쓰지 말고 기준으로 찾는다.」 기준은 둘이다 —
--   ① 사람이 만드는 줄인가 (기계가 찍는 것은 뺀다)
--   ② 부모를 타고 올라가도 팀에 못 닿는가 (닿으면 안 넣는다)
-- 표 41개를 외래키 76개로 전부 훑었다. 전문은 같은 폴더의 `067-전수조사.md`.
--
--   066 부터   task · goal · project · note
--   067 에 더함 signal · event · artifact · review_session · handover ·
--              saved_view · personal_event · area
--
-- 빠진 표를 나중에 채우는 것은 다시 데이터 작업이고, 그때는 줄이 더 쌓여 있다
-- (§E-28). 그래서 **한 번에** 넣는다.
--
-- ── 실행 전 확인 (짐작하지 않고 실제 스키마를 읽었다) ──────────────
--
--   · `team` 이라는 표·컬럼은 **없다.** 닮은 이름은 `event.is_team`(참/거짓 —
--     팀 일정인가 개인 일정인가) 하나뿐이고, 뜻이 다르며 이 파일은 안 건드린다
--   · 열두 표의 PK 는 전부 `id` (integer, serial) 다. `team_id` 라는 이름은 비어 있다
--   · 행 수(로컬) — task 44 · goal 7 · project 9 · note 0 · signal 8 · event 5 ·
--     artifact 0 · review_session 0 · handover 0 · saved_view 0 ·
--     personal_event 0 · area 7
--   · `note` 는 `db/schema.sql` 에 **없고** `0026_personal_space.sql` 에만 있다.
--     러너는 0026 을 먼저 돌리므로 여기까지 오면 있다(066 에서 확인)
--
-- ── 러너가 이 파일에서 멈추면 어떻게 되는가 ──────────────────────
--
-- 0031·0035 의 자리다 — 러너가 실패하면 그 뒤 전 요청이 500 이 된다.
-- 그래서 **비파괴만** 한다: CREATE TABLE IF NOT EXISTS · ADD COLUMN IF NOT EXISTS ·
-- SET DEFAULT · SET NOT NULL · CREATE INDEX IF NOT EXISTS. UPDATE 는 빈 줄에만 닿는다.
-- 지우는 문장이 없다. 두 번 돌려도 같은 결과다(멱등).
--
-- DEFAULT 값을 **숫자로 박지 않는다.** `team` 의 id 는 serial 이라 환경마다 다를
-- 수 있고, 1 이라고 박으면 다른 환경에서 조용히 틀린 팀을 가리킨다 —
-- `area` 의 id 를 코드에 박을 수 없었던 것과 같은 이유다(043 §1).
-- 그래서 id 를 읽어서 ALTER 문을 만든다.
--
-- 표 목록은 **한 곳**(아래 배열 두 군데가 아니라 `tbls` 하나)에만 적는다 —
-- 칸을 더하는 자리와 채우는 자리가 다른 목록을 보면 하나가 빠진다.
--
-- 되돌리기: `0036_team_column_down.sql`
--   ⚠ 되돌리기는 **컬럼 열둘과 표 하나를 지운다.** 채워 둔 팀 값이 통째로 사라진다.

-- ① 팀 표 — 셋뿐이다. 소속·역할은 여기 없다
CREATE TABLE IF NOT EXISTS team (
  id         SERIAL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ② AIoT 한 줄. `key` 는 사람이 안 바꾸는 이름이고 `name` 은 화면에 쓸 이름이다
INSERT INTO team (key, name) VALUES ('aiot', 'AIoT')
  ON CONFLICT (key) DO NOTHING;

-- ③④⑤ 칸을 더하고 · 채우고 · DEFAULT 를 걸고 · 잠그고 · 색인을 둔다
DO $$
DECLARE
  t    INTEGER;
  tbl  TEXT;
  tbls TEXT[] := ARRAY[
    -- 066 부터
    'task', 'goal', 'project', 'note',
    -- 067 §E-1 에서 기준으로 찾은 것
    'signal', 'event', 'artifact', 'review_session', 'handover',
    'saved_view', 'personal_event', 'area'
  ];
BEGIN
  SELECT id INTO t FROM team WHERE key = 'aiot';
  -- 없으면 **여기서 멈춘다.** 조용히 넘어가면 NOT NULL 을 걸 때 죽고,
  -- 그때는 무엇이 없어서 죽었는지가 안 보인다.
  IF t IS NULL THEN
    RAISE EXCEPTION '0036: team.key = aiot 행이 없다 — ② 의 INSERT 가 안 들어갔다';
  END IF;

  FOREACH tbl IN ARRAY tbls LOOP
    -- 표가 없으면 **이름을 대고** 멈춘다. `ALTER TABLE` 이 알아서 죽게 두면
    -- 「relation does not exist」만 남고 어느 줄에서였는지 찾아야 한다.
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE EXCEPTION '0036: 표 % 가 없다 — 앞선 마이그레이션이 덜 돌았다', tbl;
    END IF;
    /*
     * ── **UPDATE 로 채우지 않는다** (067 §E-29 에서 고쳤다) ──────────
     *
     * 066 판은 `ADD COLUMN` 뒤에 `UPDATE … SET team_id` 로 채웠다. 그런데
     * `task` 에는 BEFORE UPDATE 트리거가 **다섯** 있다 — 영역·프로젝트 일치 ·
     * 막힘 순환 · 막힘 파생 · 깊이 · 개인 업무 주인. UPDATE 는 **모든 줄에서**
     * 그 다섯을 돌린다.
     *   · 옛 줄 하나라도 조건을 어기면 마이그레이션이 멈추고 → 러너가 멈추고 →
     *     **전 요청이 500** 이다(0031 의 자리)
     *   · `trg_task_blocked_derive` 는 **값을 바꾼다** — 팀 칸을 채우다가
     *     막힘 표시가 같이 바뀔 수 있다
     * 066 의 검사용 DB 에는 줄이 1개라 안 드러났다.
     *
     * `ADD COLUMN … NOT NULL DEFAULT <상수>` 는 기존 줄을 **UPDATE 없이** 채운다
     * (Postgres 11 부터 목록에 값을 적어 두는 방식). 트리거가 안 돈다.
     * 새 줄은 DEFAULT 로 채워진다 — 값을 비워 두지 않는다.
     */
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS team_id INTEGER NOT NULL DEFAULT %s REFERENCES team(id)',
      tbl, t);
    /*
     * 안전망 — 칸이 **이미 있는데 비어 있는** 줄(앞선 실행이 반쯤 된 경우)만
     * 채운다. 처음 적용에서는 **0줄**이라 트리거가 한 번도 안 돈다.
     */
    EXECUTE format('UPDATE %I SET team_id = %s WHERE team_id IS NULL', tbl, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET DEFAULT %s', tbl, t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN team_id SET NOT NULL', tbl);
    -- 합칠 때 팀으로 훑는다
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(team_id)', 'idx_' || tbl || '_team', tbl);
  END LOOP;
END $$;
