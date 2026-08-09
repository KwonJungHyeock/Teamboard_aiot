-- MD-P-2026-028 C-a/C-b — sort_order 한 번 정리
--
-- **문제.** 023 backfill 은 생성순이 맞다. 그런데 그 뒤에 만들어진 업무는
-- 컬럼 기본값 0 으로 남아, "직접 정한 순서" 로 보면 **가장 새것이 맨 앞**에 온다.
-- (로컬 실측: 프로젝트 #1 의 26건 중 9건이 sort_order = 0, 전부 같은 날 생성)
--
-- 정렬 기준 (C-b-1 지시 그대로):
--     (sort_order = 0) ASC,  sort_order ASC,  created_at ASC,  id ASC
--   → 0 인 것이 뒤로 가고, 나머지는 **기존 순서를 보존**한 채 1..N 으로 다시 매겨진다.
--
--
-- ⚠️ 묶는 단위가 두 가지입니다. 하나를 골라 주세요.
--
--   [A] 형제 전체 (parent_task_id 기준) — **앱이 실제로 읽는 단위**
--       /tasks 의 "직접 정한 순서" 는 프로젝트를 가로질러 한 목록으로 정렬합니다.
--       POST /api/tasks/reorder 도 parent_task_id 로 형제를 모아 1..N 을 매깁니다.
--       지금 데이터는 프로젝트별로 1..N 이 **겹쳐** 있어(프로젝트 #1 도 1, #2 도 1)
--       전역 정렬이 프로젝트끼리 섞입니다. A 는 그것까지 함께 풉니다.
--
--   [B] 프로젝트별 (C-b-1 문면 그대로)
--       023 backfill 과 같은 단위입니다. 프로젝트 안에서는 깔끔하지만,
--       **전역 목록의 섞임은 남습니다.**
--
-- 저는 [A] 를 권합니다 — 화면이 읽는 단위와 저장 단위를 같게 두는 편이 맞습니다.
-- 다만 지시서 문면은 [B] 라서 임의로 정하지 않고 둘 다 냅니다.
--
-- 하위 업무는 양쪽 모두 **자기 상위 안에서만** 다시 매깁니다 (§C3).


-- ════════════════════════════════════════════════════════════════════
-- ① 실행 전 확인 — 읽기 전용. 지금 상태를 봅니다.
-- ════════════════════════════════════════════════════════════════════
SELECT
  COALESCE(project_id, 0)                          AS "프로젝트(0=없음)",
  count(*)                                         AS "업무",
  count(*) FILTER (WHERE sort_order = 0)           AS "sort_order=0",
  min(sort_order)                                  AS "최소",
  max(sort_order)                                  AS "최대",
  count(DISTINCT sort_order)                       AS "서로 다른 값"
FROM task
WHERE is_active = true AND parent_task_id IS NULL
GROUP BY 1 ORDER BY 1;

-- 0 인 것들이 정말 "나중에 만들어진 것"인지 — 이 확인이 정리의 근거입니다.
SELECT
  CASE WHEN sort_order = 0 THEN 'sort_order = 0' ELSE 'sort_order > 0' END AS "구분",
  count(*) AS "건수", min(created_at)::date AS "가장 이른 생성", max(created_at)::date AS "가장 늦은 생성"
FROM task
WHERE is_active = true AND parent_task_id IS NULL
GROUP BY 1 ORDER BY 1;


-- ════════════════════════════════════════════════════════════════════
-- ②-A  [A] 형제 전체 기준 — 권장
--      최상위끼리 한 묶음, 하위는 각자의 상위 안에서 한 묶음.
-- ════════════════════════════════════════════════════════════════════
-- 미리보기 (읽기 전용) — 실행 전에 이것부터 보세요.
WITH ranked AS (
  SELECT id, title, project_id, sort_order AS old_order,
         row_number() OVER (
           PARTITION BY parent_task_id
           ORDER BY (sort_order = 0) ASC, sort_order ASC, created_at ASC, id ASC
         ) AS new_order
    FROM task WHERE is_active = true
)
SELECT id AS "id", title AS "업무", COALESCE(project_id, 0) AS "프로젝트",
       old_order AS "전", new_order AS "후",
       CASE WHEN old_order = new_order THEN '' ELSE '←' END AS "바뀜"
  FROM ranked ORDER BY new_order, id;

-- 실행 (되돌리려면 아래 ③ 을 미리 떠 두세요)
-- UPDATE task AS t SET sort_order = r.new_order, updated_at = now()
--   FROM (
--     SELECT id, row_number() OVER (
--              PARTITION BY parent_task_id
--              ORDER BY (sort_order = 0) ASC, sort_order ASC, created_at ASC, id ASC
--            ) AS new_order
--       FROM task WHERE is_active = true
--   ) AS r
--  WHERE t.id = r.id AND t.sort_order IS DISTINCT FROM r.new_order;


-- ════════════════════════════════════════════════════════════════════
-- ②-B  [B] 프로젝트별 — C-b-1 문면 그대로
--      프로젝트가 없는 업무(project_id IS NULL)도 한 묶음입니다 (C-b-2).
-- ════════════════════════════════════════════════════════════════════
-- 미리보기 (읽기 전용)
WITH ranked AS (
  SELECT id, title, project_id, sort_order AS old_order,
         row_number() OVER (
           PARTITION BY parent_task_id, COALESCE(project_id, 0)
           ORDER BY (sort_order = 0) ASC, sort_order ASC, created_at ASC, id ASC
         ) AS new_order
    FROM task WHERE is_active = true
)
SELECT id AS "id", title AS "업무", COALESCE(project_id, 0) AS "프로젝트",
       old_order AS "전", new_order AS "후",
       CASE WHEN old_order = new_order THEN '' ELSE '←' END AS "바뀜"
  FROM ranked ORDER BY COALESCE(project_id, 0), new_order, id;

-- 실행
-- UPDATE task AS t SET sort_order = r.new_order, updated_at = now()
--   FROM (
--     SELECT id, row_number() OVER (
--              PARTITION BY parent_task_id, COALESCE(project_id, 0)
--              ORDER BY (sort_order = 0) ASC, sort_order ASC, created_at ASC, id ASC
--            ) AS new_order
--       FROM task WHERE is_active = true
--   ) AS r
--  WHERE t.id = r.id AND t.sort_order IS DISTINCT FROM r.new_order;


-- ════════════════════════════════════════════════════════════════════
-- ③ 되돌리기용 — 실행 **전에** 떠 두세요
-- ════════════════════════════════════════════════════════════════════
-- SELECT id, sort_order FROM task WHERE is_active = true ORDER BY id;
--   되돌릴 때:
--   UPDATE task SET sort_order = v.o FROM (VALUES (id1,o1),(id2,o2),…) AS v(i,o) WHERE task.id = v.i;
