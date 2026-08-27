-- MD-P-2026-032 §A 되돌리기 — 0029 · 0030 · 0031 을 **역순으로** 한 파일에.
--
-- ⚠ **이 파일은 자동으로 돌지 않는다.** `db/migrations/rollback/` 은 러너가 안 읽는다.
--    사람이 골라서 돌린다.
--
-- ⚠ **`schema_migrations` 에서 줄을 지우지 않는다** (RUNBOOK 규약) — 이력이 어긋난다.
--    되돌린 뒤 다시 적용해야 하면 **새 번호로 정방향 마이그레이션을 쓴다.**
--
-- ── 어디까지 되돌릴지 먼저 정한다 ─────────────────────────────────
--
-- 세 단계는 각각 독립적으로 되돌릴 수 있다. **아래에서 위로** 지운다.
--   ③만 되돌리기  — 업무를 상시에서 떼어 낸다. 프로젝트와 컬럼은 남는다.
--   ③②           — 상시 프로젝트도 지운다.
--   ③②①         — 컬럼까지 지운다. 완전 원상복구.
--
-- ⚠ **③은 시간이 지날수록 위험해진다.** 배치 ③ 직후에는 「상시에 붙은 업무」가
--    마이그레이션이 붙인 것뿐이지만, 그 뒤 사람이 화면에서 붙인 것도 섞인다.
--    그때는 아래 ③을 그대로 돌리면 **사람이 한 일까지 지운다.**
--    시점을 확인하고, 필요하면 `updated_at` 으로 좁힌다.

-- ══════════════════════════════════════════════════════════════════
-- ③ 업무 귀속 되돌리기 (0031)
-- ══════════════════════════════════════════════════════════════════
--
-- 되돌리기 전에 **몇 건이 떨어지는지 먼저 센다.**
--   SELECT count(*) FROM task t JOIN project p ON p.id = t.project_id
--    WHERE p.type = 'standing';
--
-- 배치 ③ 직후라면 이 수 = 옮긴 수(로컬 19). 그보다 크면 사람이 붙인 것이 섞여 있다.

UPDATE task t
   SET project_id = NULL
  FROM project p
 WHERE t.project_id = p.id
   AND p.type = 'standing';

-- ══════════════════════════════════════════════════════════════════
-- ② 상시 프로젝트 되돌리기 (0030)
-- ══════════════════════════════════════════════════════════════════
--
-- 업무가 아직 붙어 있으면 지우지 않는다 — 위 ③을 먼저 돌리라는 뜻이다.
-- (`task.project_id` 는 FK 라 붙어 있는 채로 지우면 실패한다. 조용히 넘어가지 않게
--  조건으로 걸러 **지워질 것만** 지운다.)

DELETE FROM project
 WHERE type = 'standing'
   AND NOT EXISTS (SELECT 1 FROM task t WHERE t.project_id = project.id);

-- ══════════════════════════════════════════════════════════════════
-- ① 컬럼 되돌리기 (0029)
-- ══════════════════════════════════════════════════════════════════
--
-- ⚠ 위 ②가 다 지워졌는지 먼저 본다. `standing` 행이 남아 있는데 컬럼을 지우면
--    그 행들이 **무엇이었는지 알 수 없게 된다.**
--   SELECT count(*) FROM project WHERE type = 'standing';   -- 0 이어야 한다

ALTER TABLE project DROP CONSTRAINT IF EXISTS project_standing_no_goal;
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_type_check;
ALTER TABLE project DROP COLUMN IF EXISTS type;

-- ══════════════════════════════════════════════════════════════════
-- 되돌린 뒤 확인
-- ══════════════════════════════════════════════════════════════════
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'project' AND column_name = 'type';        -- 0
--   SELECT count(*) FROM project;                                   -- 스냅샷의 수
--   SELECT count(*) FROM task WHERE is_active AND project_id IS NULL;
--     -- 스냅샷의 「프로젝트 없는 활성 업무」 수로 돌아왔는가
--   SELECT count(*) FROM goal_task;                                 -- 스냅샷과 같아야 한다
