-- ⚠ **팀이 둘이 되면 이 되돌리기는 못 쓴다.** 팀 값을 통째로 지우므로, 다시 적용하면 전부 AIoT 가 된다.
--
-- 되돌리기: 0036_team_column.sql (MD-P-2026-066 §F · 067 §E)
--
-- ⚠ **채워 둔 팀 값이 통째로 사라진다.** 컬럼을 지우기 때문이다. 다시 걸면
--    전부 `AIoT` 로 채워지지만, 그 사이에 다른 팀 값이 들어가 있었다면 그것도
--    같이 없어진다.
--
-- 러너는 이 폴더를 **안 읽는다**(사람이 손으로 돌린다). 0034·0035 와 같은 규약이다.
-- 표 목록은 0036 과 **같은 열둘**이다 — 하나가 빠지면 그 표의 칸이 남아서
-- `team` 표를 못 지운다(참조 중이라).

DO $$
DECLARE
  tbl  TEXT;
  tbls TEXT[] := ARRAY[
    'task', 'goal', 'project', 'note',
    'signal', 'event', 'artifact', 'review_session', 'handover',
    'saved_view', 'personal_event', 'area'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
      EXECUTE format('DROP INDEX IF EXISTS %I', 'idx_' || tbl || '_team');
      EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS team_id', tbl);
    END IF;
  END LOOP;
END $$;

-- 표는 마지막에. 위 컬럼들이 이 표를 참조하고 있어서 순서가 뒤바뀌면 못 지운다.
DROP TABLE IF EXISTS team;
