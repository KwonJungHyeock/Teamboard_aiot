-- MD-P-2026-028 C-a/C-b — sort_order 한 번 정리
-- MD-P-2026-031 §0-2 확정: **[A] 형제 전체 기준으로 한다. [B] 프로젝트별은 폐기.**
--
-- **문제.** 023 backfill 은 생성순이 맞다. 그런데 그 뒤에 만들어진 업무는
-- 컬럼 기본값 0 으로 남아, "직접 정한 순서" 로 보면 **가장 새것이 맨 앞**에 온다.
-- (0 이 가장 작은 값이므로 오름차순에서 맨 앞이다 — components/TasksView.tsx 의
--  manual 비교자가 `(a.sortOrder ?? 0) - (b.sortOrder ?? 0)` 이다.)
--
-- **묶는 단위 = parent_task_id (형제 전체).**
--   최상위끼리 한 묶음, 하위는 각자의 상위 안에서 한 묶음.
--   POST /api/tasks/reorder 가 형제를 모으는 단위와 같고,
--   화면의 "직접 정한 순서" 가 읽는 단위와도 같다.
--   프로젝트로 쪼개지 않으므로 프로젝트 없는 업무도 자연히 같은 묶음에 든다.
--
-- **정렬 기준 (C-b-1 지시 그대로):**
--     (sort_order = 0) ASC,  sort_order ASC,  created_at ASC,  id ASC
--   → 0 인 것이 뒤로 가고, 나머지는 **기존 순서를 보존**한 채 1..N 으로 다시 매겨진다.
--
-- **실행 순서.** ① → ② → ③ → ④ 를 차례로. ② 를 뜨지 않고 ③ 을 실행하지 말 것.


-- ════════════════════════════════════════════════════════════════════
-- ① 실행 전 확인 — 읽기 전용. 지금 상태와 바뀔 결과를 봅니다.
-- ════════════════════════════════════════════════════════════════════

-- ①-1 현재 분포
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

-- ①-2 0 인 것들이 정말 "나중에 만들어진 것"인지 — 이 확인이 정리의 근거입니다.
SELECT
  CASE WHEN sort_order = 0 THEN 'sort_order = 0' ELSE 'sort_order > 0' END AS "구분",
  count(*) AS "건수", min(created_at)::date AS "가장 이른 생성", max(created_at)::date AS "가장 늦은 생성"
FROM task
WHERE is_active = true AND parent_task_id IS NULL
GROUP BY 1 ORDER BY 1;

-- ①-3 바뀔 결과 미리보기 — ③ 이 쓸 값과 **같은 식**입니다.
WITH ranked AS (
  SELECT id, title, project_id, parent_task_id, sort_order AS old_order,
         row_number() OVER (
           PARTITION BY parent_task_id
           ORDER BY (sort_order = 0) ASC, sort_order ASC, created_at ASC, id ASC
         ) AS new_order
    FROM task WHERE is_active = true
)
SELECT id AS "id", title AS "업무", COALESCE(project_id, 0) AS "프로젝트",
       COALESCE(parent_task_id, 0) AS "상위(0=최상위)",
       old_order AS "전", new_order AS "후",
       CASE WHEN old_order = new_order THEN '' ELSE '←' END AS "바뀜"
  FROM ranked
 ORDER BY COALESCE(parent_task_id, 0), new_order, id;


-- ════════════════════════════════════════════════════════════════════
-- ② 되돌리기용 스냅샷 — ③ 실행 **전에** 반드시 떠 두세요
-- ════════════════════════════════════════════════════════════════════
-- 결과를 통째로 복사해 보관하십시오. 되돌릴 일이 생기면 이 값이 유일한 근거입니다.
SELECT id, sort_order FROM task WHERE is_active = true ORDER BY id;

--   되돌릴 때:
--   UPDATE task SET sort_order = v.o
--     FROM (VALUES (id1,o1),(id2,o2), …) AS v(i,o)
--    WHERE task.id = v.i;


-- ════════════════════════════════════════════════════════════════════
-- ③ 실행 — 쓰기. ② 를 뜬 뒤에만.
-- ════════════════════════════════════════════════════════════════════
BEGIN;

UPDATE task AS t
   SET sort_order = r.new_order, updated_at = now()
  FROM (
    SELECT id, row_number() OVER (
             PARTITION BY parent_task_id
             ORDER BY (sort_order = 0) ASC, sort_order ASC, created_at ASC, id ASC
           ) AS new_order
      FROM task WHERE is_active = true
  ) AS r
 WHERE t.id = r.id
   AND t.sort_order IS DISTINCT FROM r.new_order;

-- 여기서 갱신 건수가 ①-3 의 "←" 개수와 같은지 보고 COMMIT 하십시오.
COMMIT;


-- ════════════════════════════════════════════════════════════════════
-- ④ 사후 확인 — 읽기 전용
-- ════════════════════════════════════════════════════════════════════

-- ④-1 남아 있는 0 은 없어야 합니다 (기대: 0건)
SELECT count(*) AS "sort_order = 0 남은 건수"
  FROM task WHERE is_active = true AND sort_order = 0;

-- ④-2 형제 묶음마다 1..N 이 빠짐없이 한 번씩 — "빈칸"과 "겹침" 둘 다 0이어야 합니다.
SELECT COALESCE(parent_task_id, 0)                       AS "상위(0=최상위)",
       count(*)                                          AS "형제 수",
       min(sort_order)                                   AS "최소",
       max(sort_order)                                   AS "최대",
       max(sort_order) - count(*)                        AS "빈칸(0이어야 함)",
       count(*) - count(DISTINCT sort_order)             AS "겹침(0이어야 함)"
  FROM task WHERE is_active = true
 GROUP BY 1 ORDER BY 1;
