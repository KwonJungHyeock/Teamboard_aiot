-- MD-P-2026-073 §A-8 — 「완료가 아닌데 진행률 100」인 업무를 **세기만** 한다. 고치지 않는다.
--
-- 읽기 전용(SELECT 만). 프로덕션 DB 에 쓰지 않는다.
-- CC 의 작업 환경에는 프로덕션 DB 주소가 없어(로컬 127.0.0.1 뿐) 여기서는 못 돌렸다.
--
-- 무엇을 세는가
--   · 활성 업무 · 완료가 아니다(proposed · dropped 도 뺀다 — 제안·중단은 진행률을 안 본다)
--   · 저장된 진행률(task.progress)이 100
--   · **하위로 계산되지 않는다** — 집계 대상 하위가 있으면 저장값은 화면·목표 진척에 안 쓰인다
--     (lib/progress.ts taskProgress). 그런 업무의 100 은 틀린 값이 아니라 안 쓰이는 값이다
--
-- 둘째 칸은 「070 되돌리기 때문에 생긴 것 같은가」의 단서다 — 완료 → 다른 상태로 되돌린 기록이 있다.
-- 사람이 일부러 100 을 적고 아직 완료를 안 누른 업무도 첫 칸에 섞인다. 둘째 칸이 그걸 가른다.

SELECT count(*) AS "완료 아님 · 진행률 100",
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM activity_log a
          WHERE a.task_id = t.id AND a.message LIKE '%업무 상태 변경 (done → %'
       )) AS "그중 완료를 되돌린 기록이 있는 것"
  FROM task t
 WHERE t.is_active
   AND t.status NOT IN ('done', 'proposed', 'dropped')
   AND t.progress = 100
   AND NOT EXISTS (
     -- 「집계 대상 하위」 — lib/progress.ts 의 countableSql("c") 를 글자 그대로 옮겼다
     SELECT 1 FROM task c
      WHERE c.parent_task_id = t.id
        AND c.is_active = true AND c.status <> 'proposed' AND c.status <> 'dropped'
        AND c.work_type <> 'routine'
        AND (c.resolution IS NULL OR c.resolution NOT IN ('canceled', 'duplicate'))
   );

-- 화면에서 고칠 목록이 필요하면 위 FROM/WHERE 그대로 아래를 돌린다(역시 읽기만).
-- SELECT t.id, t.title, t.status, t.progress, t.updated_at FROM task t WHERE … ORDER BY t.id;
