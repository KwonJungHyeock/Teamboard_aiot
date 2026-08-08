-- MD-P-2026-030 §C1 — 프로젝트 경유를 빼면 목표 진척이 어떻게 바뀌는가 (프로덕션용)
--
-- **읽기 전용입니다. 아무것도 바꾸지 않습니다.** SELECT 뿐입니다.
-- Neon 콘솔 Query 창에 섹션별로 붙여 실행하세요.
--
-- 왜 SQL 로 따로 내는가.
--   로컬 시드로는 프로덕션 실태를 볼 수 없습니다. 029 에서 그 사례가 있었습니다 —
--   로컬 Q3 는 2개인데 프로덕션은 4개였고, 그 차이가 설계를 틀리게 만들었습니다.
--   이번 지시서의 숫자(연간 #8 73% · 21건 · 배너 39건)도 프로덕션 값입니다.
--
-- 지금 계산식 (lib/projects.ts goalSubtreeTaskInput):
--   목표 하위 트리 업무 =
--     ① 그 목표(또는 하위 목표)에 직접 연결된 업무 (goal_task)
--     ② 그 목표(또는 하위 목표)를 goal_id 로 가리키는 프로젝트의 업무   ← 이번에 뺍니다


-- ════════════════════════════════════════════════════════════════════
-- ① 프로젝트 → 목표 연결 현황
-- ════════════════════════════════════════════════════════════════════
SELECT
  p.id                AS "프로젝트id",
  p.name              AS "프로젝트",
  g.id                AS "목표id",
  g.title             AS "목표",
  g.period_type       AS "주기",
  g.period_start      AS "기간",
  (SELECT count(*) FROM task t
    WHERE t.project_id = p.id AND t.is_active AND t.status <> 'proposed'
      AND t.work_type <> 'routine' AND t.status <> 'dropped'
      AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))) AS "프로젝트의 집계대상 업무"
FROM project p
JOIN goal g ON g.id = p.goal_id
WHERE p.is_active = true AND g.is_active = true
ORDER BY g.id, p.id;


-- ════════════════════════════════════════════════════════════════════
-- ② 변경 전후 진척 — 이 표가 §C1 의 본체입니다
--
--    "전" = 지금 화면에 뜨는 값 (프로젝트 경유 포함)
--    "후" = 프로젝트 경유를 뺐을 때
--    수동값(progress_manual)이 있으면 화면 값은 그대로입니다. 집계만 바뀝니다.
-- ════════════════════════════════════════════════════════════════════
WITH RECURSIVE
-- 영향을 받는 목표 = 프로젝트가 가리키는 목표 + 그 조상 전부
seed AS (
  SELECT DISTINCT g.id FROM goal g JOIN project p ON p.goal_id = g.id
   WHERE g.is_active AND p.is_active
),
up AS (
  SELECT id, id AS root FROM seed
  UNION ALL
  SELECT g.parent_id, u.root FROM up u JOIN goal g ON g.id = u.id
   WHERE g.parent_id IS NOT NULL
),
affected AS (SELECT DISTINCT id FROM up WHERE id IS NOT NULL),
-- 각 목표의 하위 트리
sub AS (
  SELECT a.id AS goal_id, a.id AS node FROM affected a
  UNION ALL
  SELECT s.goal_id, g.id FROM sub s JOIN goal g ON g.parent_id = s.node WHERE g.is_active
),
countable AS (
  SELECT t.id, t.status, t.progress, t.project_id
    FROM task t
   WHERE t.is_active AND t.parent_task_id IS NULL AND t.status <> 'proposed'
     AND t.work_type <> 'routine' AND t.status <> 'dropped'
     AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
),
-- 전: 직접 연결 OR 프로젝트 경유
with_p AS (
  SELECT s.goal_id, c.id, c.status, c.progress
    FROM sub s
    JOIN countable c ON
         EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = c.id AND gt.goal_id = s.node)
      OR EXISTS (SELECT 1 FROM project p WHERE p.id = c.project_id AND p.goal_id = s.node
                   AND p.is_active AND p.status <> 'archived')
   GROUP BY s.goal_id, c.id, c.status, c.progress
),
-- 후: 직접 연결만
no_p AS (
  SELECT s.goal_id, c.id, c.status, c.progress
    FROM sub s
    JOIN countable c ON
         EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = c.id AND gt.goal_id = s.node)
   GROUP BY s.goal_id, c.id, c.status, c.progress
)
SELECT
  g.id                                     AS "목표id",
  g.title                                  AS "목표",
  g.period_type                            AS "주기",
  g.period_start                           AS "기간",
  g.progress_manual                        AS "수동값",
  (SELECT count(*) FROM with_p w WHERE w.goal_id = g.id)          AS "집계대상 전",
  (SELECT count(*) FROM no_p   n WHERE n.goal_id = g.id)          AS "집계대상 후",
  (SELECT round(avg(CASE WHEN w.status = 'done' THEN 100 ELSE COALESCE(w.progress, 0) END))
     FROM with_p w WHERE w.goal_id = g.id)                        AS "집계값 전",
  (SELECT round(avg(CASE WHEN n.status = 'done' THEN 100 ELSE COALESCE(n.progress, 0) END))
     FROM no_p   n WHERE n.goal_id = g.id)                        AS "집계값 후",
  COALESCE(g.progress_manual,
    (SELECT round(avg(CASE WHEN w.status = 'done' THEN 100 ELSE COALESCE(w.progress, 0) END))
       FROM with_p w WHERE w.goal_id = g.id))                     AS "화면값 전",
  COALESCE(g.progress_manual,
    (SELECT round(avg(CASE WHEN n.status = 'done' THEN 100 ELSE COALESCE(n.progress, 0) END))
       FROM no_p   n WHERE n.goal_id = g.id))                     AS "화면값 후"
FROM goal g
WHERE g.id IN (SELECT id FROM affected) AND g.is_active
ORDER BY
  CASE g.period_type WHEN 'year' THEN 1 WHEN 'quarter' THEN 2 ELSE 3 END,
  g.period_start, g.id;


-- ════════════════════════════════════════════════════════════════════
-- ③ §B 기준 차이 — 배너와 진척이 서로 다른 집합을 본다
-- ════════════════════════════════════════════════════════════════════
-- 조건은 lib/progress.ts 의 unlinkedTaskSql 과 글자 그대로 같아야 합니다.
-- (parent_task_id IS NULL 이 빠져 있어 하위 업무까지 세던 것을 바로잡았습니다)
SELECT
  (SELECT count(*) FROM task t
    WHERE t.parent_task_id IS NULL
      AND t.is_active AND t.status <> 'proposed' AND t.work_type <> 'routine'
      AND t.status <> 'dropped' AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
      AND t.visibility = 'team'
      AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id)
      AND t.goal_source <> 'none')                            AS "배너가 세는 미연결",
  (SELECT count(*) FROM task t
     JOIN project p ON p.id = t.project_id AND p.goal_id IS NOT NULL
    WHERE t.parent_task_id IS NULL
      AND t.is_active AND t.status <> 'proposed' AND t.work_type <> 'routine'
      AND t.status <> 'dropped' AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
      AND t.visibility = 'team'
      AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id))
                                                              AS "그중 프로젝트 경유로 진척엔 잡히던 것";

-- 프로젝트 경유가 끌어오는, **그 목표에 직접 붙지 않은** 업무.
-- 프로젝트가 8월 목표를 가리키면 그 프로젝트의 7월 업무까지 8월 분모에 들어갑니다.
SELECT p.goal_id AS "목표id", g.title AS "목표", count(*) AS "분모에 섞이는 남의 업무"
  FROM task t
  JOIN project p ON p.id = t.project_id AND p.goal_id IS NOT NULL
  JOIN goal g ON g.id = p.goal_id
 WHERE t.is_active AND t.parent_task_id IS NULL AND t.status <> 'proposed'
   AND t.work_type <> 'routine' AND t.status <> 'dropped'
   AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
   AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id AND gt.goal_id = p.goal_id)
 GROUP BY p.goal_id, g.title
 ORDER BY p.goal_id;


-- ════════════════════════════════════════════════════════════════════
-- ④ §A4 goal_source 현황 — inherited 를 어떻게 정리할지 근거
-- ════════════════════════════════════════════════════════════════════
SELECT goal_source AS "출처", count(*) AS "건수"
  FROM task WHERE is_active GROUP BY 1 ORDER BY 1;

SELECT
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id))
    AS "inherited 인데 직접 링크 있음 (→ manual)",
  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id))
    AS "inherited 이고 링크 없음 (→ 그대로, 미지정)"
FROM task t WHERE t.is_active AND t.goal_source = 'inherited';
