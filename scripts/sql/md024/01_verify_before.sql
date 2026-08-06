-- ============================================================
-- MD-P-2026-024 [14-1 ①] 배포 후 · 데이터 작업 전 검증
--
-- 무엇을 하나 : SELECT 만 한다. **아무것도 바꾸지 않는다.**
-- 영향 건수   : 0건 (읽기 전용)
-- 실행 위치   : Neon 콘솔 Query 창 (프로덕션)
-- 실행 순서   : 01 → 02 → 03 → 04
--
-- 판단 기준
--   A. 0023_task_structure 가 applied = 1 이어야 한다.
--      0 이면 배포/마이그레이션이 아직 안 된 것이다. **여기서 멈추고 보고할 것.**
--      (B·C 는 0023 이 적용돼야 동작한다 — resolution·parent_task_id 컬럼을 쓴다)
--   B. 목표 #9 · #11 · #12 의 진척과 분모
--   C. 프로젝트 1 · 2 · 3 의 진척과 분모
--
-- 로컬(개발) 기준값 — 프로덕션은 지시 5·6 미적용 상태라 다를 수 있다.
--   목표   #9 = 56 · #11 = 56 · #12 = (집계 없음)
--   프로젝트 1 = 67 · 2 = 0 · 3 = 40
-- ============================================================

-- ── A. 마이그레이션 적용 여부 ────────────────────────────────
SELECT 'A. 마이그레이션' AS 구분,
       filename,
       applied_at
  FROM schema_migrations
 WHERE filename = '0023_task_structure.sql';
-- 0행이면 미적용 → 중단하고 보고

-- ── B. 목표 진척 + 분모 ─────────────────────────────────────
-- 정의: 목표에 속한 업무 전체의 평균. 프로젝트는 그룹핑 단위이지 계산 단위가 아니다.
--       하위 목표 서브트리까지 훑고, 같은 업무는 DISTINCT 로 한 번만 센다.
WITH RECURSIVE sub AS (
  SELECT g.id AS root_id, g.id
    FROM goal g WHERE g.is_active = true
  UNION ALL
  SELECT s.root_id, c.id
    FROM goal c JOIN sub s ON c.parent_id = s.id
   WHERE c.is_active = true
),
countable AS (
  SELECT s.root_id, t.id AS task_id,
         CASE
           WHEN t.resolution = 'deferred' THEN 0
           WHEN t.status = 'done' THEN 100
           ELSE t.progress
         END AS p
    FROM sub s
    JOIN task t ON t.parent_task_id IS NULL
                AND t.is_active = true
                AND t.status <> 'proposed' AND t.status <> 'dropped'
                AND t.work_type <> 'routine'
                AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
    LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true AND p.status <> 'archived'
   WHERE p.goal_id = s.id
      OR EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id AND gt.goal_id = s.id)
),
dedup AS (SELECT DISTINCT root_id, task_id, p FROM countable)
SELECT 'B. 목표' AS 구분,
       g.id, left(g.title, 34) AS 제목, g.period_type AS 주기,
       g.period_start, g.period_end,
       (g.period_end < (now() AT TIME ZONE 'Asia/Seoul')::date) AS 기간종료,
       count(d.task_id)                       AS 업무수_분모,
       round(avg(d.p))                        AS 진척_재계산,
       g.progress                             AS 진척_저장값
  FROM goal g LEFT JOIN dedup d ON d.root_id = g.id
 WHERE g.is_active = true
 GROUP BY g.id, g.title, g.period_type, g.period_start, g.period_end, g.progress
 ORDER BY g.id;
-- 진척_재계산 과 진척_저장값 이 다르면 캐시가 밀린 것이다(앱 이벤트로 갱신됨). 보고할 것.
-- 업무수_분모 = 0 이면 진척은 "집계 없음" 이 맞다 (0% 아님).

-- ── C. 프로젝트 진척 + 분모 ─────────────────────────────────
-- 정의: 소속 **최상위** 업무 진척의 단순 평균. 하위 업무는 상위를 통해 이미 반영된다.
SELECT 'C. 프로젝트' AS 구분,
       p.id, p.name AS 이름, p.goal_id AS 연결목표,
       (SELECT count(*) FROM task t
         WHERE t.project_id = p.id AND t.parent_task_id IS NULL
           AND t.is_active = true AND t.status <> 'proposed' AND t.status <> 'dropped'
           AND t.work_type <> 'routine'
           AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
       ) AS 업무수_분모,
       (SELECT round(avg(CASE
                 WHEN t.resolution = 'deferred' THEN 0
                 WHEN t.status = 'done' THEN 100
                 ELSE t.progress END))
          FROM task t
         WHERE t.project_id = p.id AND t.parent_task_id IS NULL
           AND t.is_active = true AND t.status <> 'proposed' AND t.status <> 'dropped'
           AND t.work_type <> 'routine'
           AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
       ) AS 진척
  FROM project p
 WHERE p.is_active = true
 ORDER BY p.id;

-- ── D. 삭제 대상 건수 미리보기 (02 실행 전 참고) ─────────────
SELECT 'D. 삭제 예정' AS 구분,
       (SELECT count(*) FROM signal WHERE is_demo = true)                      AS 시그널,
       (SELECT count(*) FROM decision WHERE discussion_id IN
          (SELECT id FROM signal WHERE is_demo = true))                        AS 결정,
       (SELECT count(*) FROM comment WHERE signal_id IN
          (SELECT id FROM signal WHERE is_demo = true))                        AS 코멘트,
       (SELECT count(*) FROM task WHERE is_demo = true)                        AS 업무,
       (SELECT count(*) FROM goal WHERE is_demo = true)                        AS 목표;
-- 기대: 시그널 8 · 결정 3 · 코멘트 31 · 업무 20 · 목표 7
-- 다르면 멈추고 보고할 것.
