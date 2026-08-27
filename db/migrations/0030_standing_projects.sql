-- MD-P-2026-032 §A2 — 영역별 상시 프로젝트 (배치 ②/③)
--
-- ── 개수를 적지 않는다 ────────────────────────────────────────────
--
-- 「일곱 개」 같은 숫자를 여기 적지 않는다. 그 숫자는 어느 시점의 스냅샷이고,
-- 프로덕션 영역 구성은 다를 수 있으며 앞으로도 바뀐다.
-- **SQL 이 스스로 센다.**
--
--   규칙: **활성 업무가 하나라도 있는 영역에는 상시 프로젝트를 만든다.**
--         영역의 상태(workspace · link_only · 비활성)와 무관하다.
--         **업무가 있으면 그릇이 있어야 한다** — 그릇이 없으면 그 업무는
--         §B 에서 등록도 이동도 못 한다.
--
-- 「손으로 나열한 목록은 스키마가 늘 때 낡는다」의 데이터 판이다.
-- 몇 개가 만들어졌는지는 **실행 결과**로 확인한다.
--
-- ── 하나로 통합할 수 없는 이유 ────────────────────────────────────
--
-- `task.area_id` 가 NOT NULL 이고 `trg_task_area_match` 가 프로젝트와 업무의
-- 영역 일치를 강제한다. 상시 프로젝트가 하나면 **한 영역 업무만 담는다.**
--
-- 이름은 `상시 · <영역>`. 색은 영역 색을 따라간다(없으면 team).
-- 이미 있으면 안 만든다 — 두 번 돌려도 안전하다.
INSERT INTO project (name, status, color_key, area_id, type, is_active)
SELECT '상시 · ' || a.name, 'active', COALESCE(a.color_key, 'team'), a.id, 'standing', true
  FROM area a
 WHERE EXISTS (
         SELECT 1 FROM task t WHERE t.area_id = a.id AND t.is_active = true
       )
   AND NOT EXISTS (
         SELECT 1 FROM project p WHERE p.area_id = a.id AND p.type = 'standing'
       );

-- 되돌리기 — 업무를 아직 안 옮겼을 때만 안전하다(배치 ③ 전).
--   DELETE FROM project WHERE type = 'standing' AND NOT EXISTS (
--     SELECT 1 FROM task t WHERE t.project_id = project.id
--   );
