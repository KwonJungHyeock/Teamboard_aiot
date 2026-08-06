-- ============================================================
-- MD-P-2026-024 [14-1 ④] 데이터 작업 후 검증
--
-- 무엇을 하나 : SELECT 만 한다. **아무것도 바꾸지 않는다.**
-- 영향 건수   : 0건 (읽기 전용)
-- 선행 조건   : 02 · 03 COMMIT 완료
--
-- 01 과 같은 항목 + 기한 4건 + 데모 잔여 확인.
-- 결과를 그대로 붙여 주시면 로컬 결과와 대조하겠습니다.
-- ============================================================

-- ── A. 마이그레이션 ─────────────────────────────────────────
SELECT 'A. 마이그레이션' AS 구분, filename, applied_at
  FROM schema_migrations WHERE filename = '0023_task_structure.sql';

-- ── B. 목표 진척 + 분모 (01-B 와 동일 정의) ─────────────────
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
dedup AS (SELECT DISTINCT root_id, task_id, p FROM countable)
SELECT 'B. 목표' AS 구분,
       g.id, left(g.title, 34) AS 제목, g.period_type AS 주기, g.period_start, g.period_end,
       (g.period_end < (now() AT TIME ZONE 'Asia/Seoul')::date) AS 기간종료,
       count(d.task_id) AS 업무수_분모,
       round(avg(d.p))  AS 진척_재계산,
       g.progress       AS 진척_저장값,
       g.progress_manual AS 수동값
  FROM goal g LEFT JOIN dedup d ON d.root_id = g.id
 WHERE g.is_active = true
 GROUP BY g.id, g.title, g.period_type, g.period_start, g.period_end, g.progress, g.progress_manual
 ORDER BY g.id;
-- 확인 사항
--   · 진척_재계산 = 진척_저장값 이어야 한다 (03 §5 가 맞춰 놓는다)
--   · 7월 목표 #12 는 업무수_분모 = 0, 진척 = NULL, 기간종료 = true
--     → 화면에는 "기간 종료 · 마감 기록 없음" 으로 나온다 (7/31 스냅샷이 없으므로)
--   · 수동값 은 전부 NULL 이어야 한다 (마감값을 손으로 넣지 않았다)

-- ── C. 프로젝트 진척 + 분모 ─────────────────────────────────
SELECT 'C. 프로젝트' AS 구분,
       p.id, p.name AS 이름, p.goal_id AS 연결목표, left(g.title, 30) AS 목표제목,
       (SELECT count(*) FROM task t
         WHERE t.project_id = p.id AND t.parent_task_id IS NULL AND t.is_active = true
           AND t.status <> 'proposed' AND t.status <> 'dropped' AND t.work_type <> 'routine'
           AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))) AS 업무수_분모,
       (SELECT round(avg(CASE WHEN t.resolution = 'deferred' THEN 0
                              WHEN t.status = 'done' THEN 100 ELSE t.progress END))
          FROM task t
         WHERE t.project_id = p.id AND t.parent_task_id IS NULL AND t.is_active = true
           AND t.status <> 'proposed' AND t.status <> 'dropped' AND t.work_type <> 'routine'
           AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))) AS 진척
  FROM project p LEFT JOIN goal g ON g.id = p.goal_id
 WHERE p.is_active = true ORDER BY p.id;

-- ── D. 기한 4건 (지시 6) ────────────────────────────────────
SELECT 'D. 기한' AS 구분, id, left(title, 34) AS 제목, due_date, is_active
  FROM task WHERE id IN (80, 89, 96, 102) ORDER BY id;
-- 기대: 4행 모두 due_date = 2026-08-31

-- ── E. 데모 잔여 (지시 4) ───────────────────────────────────
SELECT 'E. 데모 잔여' AS 구분,
       (SELECT count(*) FROM signal WHERE is_demo = true) AS 시그널,
       (SELECT count(*) FROM task   WHERE is_demo = true) AS 업무,
       (SELECT count(*) FROM goal   WHERE is_demo = true) AS 목표,
       (SELECT count(*) FROM decision)                    AS 결정_전체;
-- 기대: 0 · 0 · 0 · 0

-- ── F. 목표 상속 상태 (지시 5-3) ────────────────────────────
SELECT 'F. 상속' AS 구분, t.goal_source, count(*) AS 업무수
  FROM task t WHERE t.is_active = true GROUP BY t.goal_source ORDER BY 1;

-- ── G. 스냅샷 이력 (지시 7 / 12) ────────────────────────────
SELECT 'G. 스냅샷' AS 구분, min(snapshot_date) AS 최초, max(snapshot_date) AS 최근, count(*) AS 행수
  FROM goal_snapshot;
-- 최초가 2026-08-04 이면 크론이 그날 생긴 것이라 정상이다 (7월분이 없는 이유).
