-- 되돌리기: 0036_team_column.sql (MD-P-2026-066 §F)
--
-- ⚠ **채워 둔 팀 값이 통째로 사라진다.** 컬럼을 지우기 때문이다. 다시 걸면
--    전부 `AIoT` 로 채워지지만, 그 사이에 다른 팀 값이 들어가 있었다면 그것도
--    같이 없어진다.
--
-- 러너는 이 폴더를 **안 읽는다**(사람이 손으로 돌린다). 0034·0035 와 같은 규약이다.

DROP INDEX IF EXISTS idx_task_team;
DROP INDEX IF EXISTS idx_goal_team;
DROP INDEX IF EXISTS idx_project_team;
DROP INDEX IF EXISTS idx_note_team;

ALTER TABLE task    DROP COLUMN IF EXISTS team_id;
ALTER TABLE goal    DROP COLUMN IF EXISTS team_id;
ALTER TABLE project DROP COLUMN IF EXISTS team_id;
ALTER TABLE note    DROP COLUMN IF EXISTS team_id;

-- 표는 마지막에. 위 컬럼들이 이 표를 참조하고 있어서 순서가 뒤바뀌면 못 지운다.
DROP TABLE IF EXISTS team;
