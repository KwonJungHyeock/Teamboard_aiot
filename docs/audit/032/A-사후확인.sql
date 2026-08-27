-- MD-P-2026-032 §A — 병합 직후 사후 확인 (Neon 에서 한 번 돌린다)
--
-- **읽기 전용이다. 아무것도 바꾸지 않는다.**
--
-- ── before 스냅샷 없이도 판정할 수 있는 이유 ──────────────────────
--
-- 아래 다섯은 전부 **절대값** 판정이다. 「0이어야 한다」 · 「두 값뿐이어야 한다」 ·
-- 「두 수가 같아야 한다」 — 이전 상태를 몰라도 통과 여부를 안다.
--
-- 포기하는 것 하나: **「영역 분포 before == after」 대조는 못 한다.**
-- 다만 배치 ③이 `p.area_id = t.area_id` 인 상시 프로젝트로만 보내고,
-- `trg_task_area_match` 가 그 일치를 강제한다. 그러므로
-- **④가 0이면 영역은 안 바뀐 것이다.** 분포 대조 없이도 그 논리가 성립한다.
--
-- ⑥은 판정이 아니라 **기록**이다. before 가 없으므로 **after 가 곧 기록**이고,
-- 나중에 되돌릴 때 「마이그레이션이 만든 것」의 유일한 근거가 된다.
-- **결과를 반드시 보관할 것.**

\echo '=== ① project.type 이 goal/standing 두 값뿐인가 (다른 값이 있으면 실패) ==='
SELECT type, count(*) AS 행수
  FROM project
 GROUP BY type
 ORDER BY type;

\echo '=== ② 활성 업무가 있는 영역 수 == 상시 프로젝트가 있는 영역 수 (같아야 한다) ==='
SELECT
  (SELECT count(*) FROM area a
    WHERE EXISTS (SELECT 1 FROM task t WHERE t.area_id = a.id AND t.is_active))
    AS 업무있는영역,
  (SELECT count(*) FROM area a
    WHERE EXISTS (SELECT 1 FROM task t WHERE t.area_id = a.id AND t.is_active)
      AND EXISTS (SELECT 1 FROM project p WHERE p.area_id = a.id AND p.type = 'standing'))
    AS 상시있는영역;

\echo '=== ③ 프로젝트 없는 활성 업무 = 0 ==='
SELECT count(*) AS 프로젝트없는활성업무
  FROM task
 WHERE is_active = true AND project_id IS NULL;

\echo '=== ④ 업무 영역 ≠ 프로젝트 영역 = 0  (0이면 영역이 안 바뀐 것이다) ==='
SELECT count(*) AS 영역불일치
  FROM task t JOIN project p ON p.id = t.project_id
 WHERE t.is_active AND t.area_id <> p.area_id;

\echo '=== ⑤ standing 인데 goal_id 있는 것 = 0 ==='
SELECT count(*) AS 상시인데목표있음
  FROM project
 WHERE type = 'standing' AND goal_id IS NOT NULL;

\echo '=== ⑥ 만들어진 상시 프로젝트 목록 — **판정이 아니라 기록. 결과를 보관할 것** ==='
SELECT p.id, p.name, p.area_id, a.name AS 영역, a.kind, a.is_active AS 영역활성
  FROM project p JOIN area a ON a.id = p.area_id
 WHERE p.type = 'standing'
 ORDER BY a.sort_order, a.id;

\echo '=== 참고 — 상시 프로젝트별로 담긴 업무 수 (⑥과 함께 보관하면 되돌릴 때 쓴다) ==='
SELECT p.id, p.name, count(t.id) AS 담긴업무
  FROM project p LEFT JOIN task t ON t.project_id = p.id AND t.is_active
 WHERE p.type = 'standing'
 GROUP BY p.id, p.name
 ORDER BY p.id;

-- ── 판정 요약 ─────────────────────────────────────────────────────
--
--   ① type 이 goal · standing **두 값뿐**            → 다른 값이 보이면 실패
--   ② 업무있는영역 == 상시있는영역                    → 다르면 그릇이 없는 영역이 있다
--   ③ 프로젝트없는활성업무 = **0**
--   ④ 영역불일치 = **0**                              → 0이면 영역이 안 바뀐 것
--   ⑤ 상시인데목표있음 = **0**
--   ⑥ 목록 — 판정 없음. **보관**한다
--
-- 개수를 기대값으로 적지 않았다. 상시 프로젝트가 몇 개인지는
-- **「활성 업무가 있는 영역 수」가 정한다**(②의 왼쪽 수). 로컬은 7이었지만
-- 그 숫자를 프로덕션에 기대하지 않는다.
