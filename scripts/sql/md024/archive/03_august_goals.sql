-- 로컬 기준. 프로덕션 불일치로 폐기(2026-08-06).
-- 실행하지 않는다. 기록으로만 남긴다 (MD-P-2026-024 회신 6 [폐기]).
--   02: 프로덕션에 데모 데이터가 없다 — 삭제 대상 0건.
--   03: 8월 월 목표가 이미 존재한다(#13·#14·#20). 프로젝트 1:1 연결 모델도 폐기됐다.
--   04: 위 둘을 전제한 검증이라 함께 폐기.
-- 남은 데이터 작업은 SQL 이 아니라 화면에서 처리한다(지시 21).
-- ============================================================
-- MD-P-2026-024 [14-1 ③ / 14-5] 8월 월 목표 3건 + 프로젝트 이관 + 기한 4건
--
-- 무엇을 하나
--   §1. 8월 팀 월 목표 3건 생성 (상위 = 분기 목표 #11, 2026-08-01 ~ 08-31)
--   §2. 프로젝트 1·2·3 을 각 8월 목표로 이관 (7월 목표 #12 는 보존, 삭제하지 않는다)
--   §3. goal_source='inherited' 인 업무의 목표 연결을 새 목표로 따라 옮긴다
--       (manual 인 업무는 건드리지 않는다 — 사용자가 직접 고른 값이다)
--   §4. 기한 없는 업무 4건(#80·#89·#96·#102) 마감일 2026-08-31
--   §5. 목표 진척 캐시 재계산
--
-- 영향 건수 (로컬 기준)
--   goal INSERT 3 · project UPDATE 3 · goal_task 재배치 약 15 · task UPDATE 4
--   goal UPDATE(진척 캐시) 활성 목표 전체
--
-- 실행 방법 : 02 와 같다. 맨 끝 COMMIT 이 주석 처리돼 있다.
--             §6 결과를 확인한 뒤 주석을 풀어 실행할 것.
-- 선행 조건 : 02 완료 (데모 목표가 지워져 있어야 id 충돌·잡음이 없다)
-- ============================================================

BEGIN;

-- ── §1. 8월 팀 월 목표 3건 ──────────────────────────────────
-- 제목은 임시안이다. 화면에서 바로 수정할 수 있다.
-- 이미 같은 제목이 있으면 만들지 않는다(재실행 안전).
INSERT INTO goal (parent_id, period_type, period_start, period_end, title, description,
                  progress_mode, scope, is_active, is_demo)
SELECT 11, 'month', DATE '2026-08-01', DATE '2026-08-31', v.title, '', 'auto', 'team', true, false
  FROM (VALUES
    ('8월 — EDUINO AI 커리큘럼 2차 완성'),
    ('8월 — Playino 엔진 코어 계약 확정'),
    ('8월 — AI 학습추론모델 이관·검증')
  ) AS v(title)
 WHERE NOT EXISTS (
   SELECT 1 FROM goal g
    WHERE g.title = v.title AND g.period_start = DATE '2026-08-01' AND g.is_active = true
 );

SELECT '§1 생성된 8월 목표' AS 구분, id, title, parent_id, period_start, period_end
  FROM goal
 WHERE period_start = DATE '2026-08-01' AND period_type = 'month' AND scope = 'team' AND is_active = true
 ORDER BY id;

-- ── §2. 프로젝트 이관 ───────────────────────────────────────
UPDATE project p SET goal_id = g.id
  FROM goal g
 WHERE g.period_start = DATE '2026-08-01' AND g.is_active = true
   AND p.is_active = true
   AND ( (p.id = 1 AND g.title = '8월 — EDUINO AI 커리큘럼 2차 완성')
      OR (p.id = 2 AND g.title = '8월 — Playino 엔진 코어 계약 확정')
      OR (p.id = 3 AND g.title = '8월 — AI 학습추론모델 이관·검증') );

SELECT '§2 프로젝트 연결' AS 구분, p.id, p.name, p.goal_id, left(g.title, 34) AS 목표
  FROM project p LEFT JOIN goal g ON g.id = p.goal_id
 WHERE p.is_active = true ORDER BY p.id;

-- ── §3. 상속(inherited) 업무만 새 목표로 따라 옮긴다 ────────
-- manual 업무는 건드리지 않는다. 앱의 applyInheritance() 와 같은 규칙이다.
DELETE FROM goal_task gt
 USING task t
 WHERE gt.task_id = t.id
   AND t.goal_source = 'inherited'
   AND t.is_active = true
   AND t.project_id IN (1, 2, 3);

INSERT INTO goal_task (goal_id, task_id)
SELECT p.goal_id, t.id
  FROM task t
  JOIN project p ON p.id = t.project_id AND p.is_active = true
 WHERE t.goal_source = 'inherited'
   AND t.is_active = true
   AND t.project_id IN (1, 2, 3)
   AND p.goal_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM goal g WHERE g.id = p.goal_id AND g.is_active = true AND g.period_type = 'month')
ON CONFLICT DO NOTHING;

SELECT '§3 상속 반영' AS 구분, t.goal_source, count(*) AS 업무수
  FROM task t WHERE t.project_id IN (1,2,3) AND t.is_active = true
 GROUP BY t.goal_source ORDER BY 2;

-- ── §4. 기한 없는 업무 4건 → 2026-08-31 (지시 14-5) ─────────
UPDATE task SET due_date = DATE '2026-08-31', updated_at = now()
 WHERE id IN (80, 89, 96, 102) AND is_active = true;

SELECT '§4 기한 지정' AS 구분, id, left(title, 34) AS 제목, due_date
  FROM task WHERE id IN (80, 89, 96, 102) ORDER BY id;
-- 기대: 4행 모두 2026-08-31

-- ── §5. 목표 진척 캐시 재계산 ───────────────────────────────
-- 앱은 이벤트마다 갱신하지만, SQL 로 직접 바꿨으니 여기서 한 번 맞춰준다.
-- 정의는 01 과 동일 — 목표에 속한 업무 전체의 평균(서브트리, DISTINCT).
WITH RECURSIVE sub AS (
  SELECT g.id AS root_id, g.id FROM goal g WHERE g.is_active = true
  UNION ALL
  SELECT s.root_id, c.id FROM goal c JOIN sub s ON c.parent_id = s.id WHERE c.is_active = true
),
countable AS (
  SELECT s.root_id, t.id AS task_id,
         CASE WHEN t.resolution = 'deferred' THEN 0
              WHEN t.status = 'done' THEN 100
              ELSE t.progress END AS p
    FROM sub s
    JOIN task t ON t.parent_task_id IS NULL AND t.is_active = true
                AND t.status <> 'proposed' AND t.status <> 'dropped' AND t.work_type <> 'routine'
                AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
    LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true AND p.status <> 'archived'
   WHERE p.goal_id = s.id
      OR EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id AND gt.goal_id = s.id)
),
dedup AS (SELECT DISTINCT root_id, task_id, p FROM countable),
agg AS (SELECT root_id, round(avg(p)) AS auto FROM dedup GROUP BY root_id)
UPDATE goal g
   SET progress_auto = a.auto,
       progress      = COALESCE(g.progress_manual, a.auto),
       updated_at    = now()
  FROM agg a
 WHERE g.id = a.root_id;

-- 집계 대상이 사라진 목표는 NULL 로 되돌린다 (0% 로 접지 않는다)
UPDATE goal g SET progress_auto = NULL, progress = g.progress_manual, updated_at = now()
 WHERE g.is_active = true
   AND NOT EXISTS (
     SELECT 1 FROM goal_task gt WHERE gt.goal_id = g.id
   )
   AND NOT EXISTS (
     SELECT 1 FROM project p WHERE p.goal_id = g.id AND p.is_active = true
   )
   AND NOT EXISTS (
     SELECT 1 FROM goal c WHERE c.parent_id = g.id AND c.is_active = true
   );

-- ── §6. 결과 확인 ───────────────────────────────────────────
SELECT '§6 목표 진척' AS 구분, id, left(title, 34) AS 제목, period_type, period_start, progress
  FROM goal WHERE is_active = true ORDER BY id;
-- 기대(프로덕션 데이터가 로컬과 같다면): #9=56 · #11=56 · #12=집계없음(NULL)
--                                        8월 3건 = 67 / 0 / 40

-- ============================================================
-- 위 §1~§6 결과를 확인한 뒤 아래 주석을 풀어 실행할 것.
-- 틀리면 대신 ROLLBACK; 을 실행한다.
--
-- COMMIT;
-- ============================================================
