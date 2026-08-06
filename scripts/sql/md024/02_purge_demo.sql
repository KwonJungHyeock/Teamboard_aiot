-- ============================================================
-- MD-P-2026-024 [14-1 ②] 데모 데이터 하드 삭제
--
-- 무엇을 하나 : 데모 시그널·결정·코멘트·업무·목표를 지운다. **되돌릴 수 없다.**
-- 순서        : 연결 해제 → 하위 → 상위
--               시그널 8 → 결정 3 → 코멘트 31 → 업무 20(#10 포함) → 목표 7
--
-- 영향 건수 (로컬 리허설 기준 — 실행 시 §1 에서 실제 건수를 다시 본다)
--   signal 8 · decision 3 · comment 31 · review_item 0
--   goal_task 14 · handover_task 2 · task_artifact 0 · task_comment 5 · activity_log 3
--   task 20 · goal 7
--
-- 실행 방법
--   1) 이 파일 전체를 Neon Query 창에 붙이고 실행한다.
--      맨 끝 COMMIT 이 주석 처리돼 있으므로 **아직 확정되지 않는다.**
--   2) §1 의 건수와 §2 의 가드 결과를 눈으로 확인한다.
--   3) 맞으면 맨 끝 `-- COMMIT;` 의 주석을 풀어 실행한다.
--      틀리면 `ROLLBACK;` 을 실행한다.
--
-- 선행 조건
--   - Neon 스냅샷 backup-pre-024-20260806 존재
--   - 결정 3건 전문 덤프 완료 → docs/archive/MD-P-2026-024_삭제전_결정로그.md
-- ============================================================

BEGIN;

-- ── §1. 삭제 대상 건수 (눈으로 확인하고 넘어갈 것) ───────────
SELECT '삭제 대상' AS 구분,
       (SELECT count(*) FROM signal   WHERE is_demo = true) AS 시그널,
       (SELECT count(*) FROM task     WHERE is_demo = true) AS 업무,
       (SELECT count(*) FROM goal     WHERE is_demo = true) AS 목표,
       (SELECT count(*) FROM decision WHERE discussion_id IN
          (SELECT id FROM signal WHERE is_demo = true))     AS 결정,
       (SELECT count(*) FROM comment  WHERE signal_id IN
          (SELECT id FROM signal WHERE is_demo = true))     AS 코멘트;
-- 기대: 8 · 20 · 7 · 3 · 31

-- ── §2. 가드 — 하나라도 걸리면 예외를 던져 트랜잭션이 죽는다 ──
-- DO 블록을 쓴다. `CASE … ELSE 1/0` 방식은 Postgres 가 상수를 미리 접어(constant folding)
-- 조건과 무관하게 division by zero 를 내므로 가드로 쓸 수 없다. (실제로 겪었다)
DO $guard$
DECLARE
  n_sig int; n_tsk int; n_gol int; n_bad int;
BEGIN
  SELECT count(*) INTO n_sig FROM signal WHERE is_demo = true;
  SELECT count(*) INTO n_tsk FROM task   WHERE is_demo = true;
  SELECT count(*) INTO n_gol FROM goal   WHERE is_demo = true;

  -- 2-1. 대상 건수가 승인된 수(8·20·7)와 다르면 중단.
  --      데이터가 승인 시점과 달라졌다는 뜻이므로 사람이 다시 봐야 한다.
  IF n_sig <> 8 OR n_tsk <> 20 OR n_gol <> 7 THEN
    RAISE EXCEPTION '중단 — 대상 건수가 승인값과 다릅니다. 시그널 % (기대 8), 업무 % (기대 20), 목표 % (기대 7)',
      n_sig, n_tsk, n_gol;
  END IF;

  -- 2-2. 지울 대상 중 is_demo = false 인 행이 하나라도 있으면 중단 (지시 14-4).
  --      대상을 is_demo = true 로 뽑으므로 정상적으로는 0 이다.
  --      플래그가 도중에 바뀌는 경우를 잡는 이중 확인이다.
  SELECT count(*) INTO n_bad FROM (
    SELECT 1 FROM signal WHERE is_demo = true AND is_demo IS DISTINCT FROM true
    UNION ALL SELECT 1 FROM task WHERE is_demo = true AND is_demo IS DISTINCT FROM true
    UNION ALL SELECT 1 FROM goal WHERE is_demo = true AND is_demo IS DISTINCT FROM true
  ) x;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '중단 — 대상에 is_demo=false 인 행이 %건 섞였습니다.', n_bad;
  END IF;

  -- 2-3. 승인 목록(결정 1·2·3) 밖의 결정이 데모 시그널에 걸리면 중단.
  SELECT count(*) INTO n_bad FROM decision
   WHERE discussion_id IN (SELECT id FROM signal WHERE is_demo = true)
     AND id NOT IN (1, 2, 3);
  IF n_bad > 0 THEN
    RAISE EXCEPTION '중단 — 승인 목록 밖의 결정 %건이 데모 시그널을 참조합니다. 삭제 승인은 결정 1·2·3 뿐입니다.', n_bad;
  END IF;

  -- 2-4. 실데이터가 데모를 참조하면 중단 (상위·차단·시그널·목표·프로젝트).
  SELECT
      (SELECT count(*) FROM task WHERE is_demo = false
        AND parent_task_id IN (SELECT id FROM task WHERE is_demo = true))
    + (SELECT count(*) FROM task WHERE is_demo = false
        AND blocked_by IN (SELECT id FROM task WHERE is_demo = true))
    + (SELECT count(*) FROM signal WHERE is_demo = false
        AND task_id IN (SELECT id FROM task WHERE is_demo = true))
    + (SELECT count(*) FROM goal WHERE is_demo = false
        AND parent_id IN (SELECT id FROM goal WHERE is_demo = true))
    + (SELECT count(*) FROM project
        WHERE goal_id IN (SELECT id FROM goal WHERE is_demo = true))
    INTO n_bad;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '중단 — 실데이터가 데모를 참조합니다 (%건). 먼저 연결을 정리해야 합니다.', n_bad;
  END IF;

  RAISE NOTICE '가드 통과 — 시그널 % · 업무 % · 목표 %', n_sig, n_tsk, n_gol;
END
$guard$;

-- ── §3. 시그널 계열 삭제 (연결 → 결정 → 시그널) ─────────────
DELETE FROM review_item WHERE signal_id IN (SELECT id FROM signal WHERE is_demo = true);

DELETE FROM comment     WHERE signal_id IN (SELECT id FROM signal WHERE is_demo = true);

-- 결정 자기참조(superseded_by) 를 먼저 끊는다
UPDATE decision SET superseded_by = NULL WHERE superseded_by IN (1, 2, 3);
-- 승인된 3건만 지운다 (전문: docs/archive/MD-P-2026-024_삭제전_결정로그.md)
DELETE FROM decision
 WHERE discussion_id IN (SELECT id FROM signal WHERE is_demo = true)
   AND id IN (1, 2, 3);

DELETE FROM signal WHERE is_demo = true;

-- ── §4. 업무 삭제 (연결 해제 → 자기참조 해제 → 업무) ────────
DELETE FROM goal_task     WHERE task_id IN (SELECT id FROM task WHERE is_demo = true);
DELETE FROM handover_task WHERE task_id IN (SELECT id FROM task WHERE is_demo = true);
DELETE FROM task_artifact WHERE task_id IN (SELECT id FROM task WHERE is_demo = true);
DELETE FROM task_comment  WHERE task_id IN (SELECT id FROM task WHERE is_demo = true);
DELETE FROM activity_log  WHERE task_id IN (SELECT id FROM task WHERE is_demo = true);
UPDATE signal SET task_id        = NULL WHERE task_id        IN (SELECT id FROM task WHERE is_demo = true);
UPDATE task   SET blocked_by     = NULL WHERE blocked_by     IN (SELECT id FROM task WHERE is_demo = true);
UPDATE task   SET parent_task_id = NULL WHERE parent_task_id IN (SELECT id FROM task WHERE is_demo = true);

DELETE FROM task WHERE is_demo = true;

-- ── §5. 목표 삭제 (연결 해제 → 하위 → 상위) ─────────────────
DELETE FROM goal_snapshot WHERE goal_id IN (SELECT id FROM goal WHERE is_demo = true);
DELETE FROM goal_task     WHERE goal_id IN (SELECT id FROM goal WHERE is_demo = true);
UPDATE project SET goal_id = NULL WHERE goal_id IN (SELECT id FROM goal WHERE is_demo = true);

DELETE FROM goal WHERE is_demo = true AND parent_id IS NOT NULL;  -- 하위 먼저
DELETE FROM goal WHERE is_demo = true;                            -- 남은 상위

-- ── §6. 결과 확인 ───────────────────────────────────────────
SELECT '삭제 후 잔여' AS 구분,
       (SELECT count(*) FROM signal WHERE is_demo = true) AS 시그널,
       (SELECT count(*) FROM task   WHERE is_demo = true) AS 업무,
       (SELECT count(*) FROM goal   WHERE is_demo = true) AS 목표;
-- 기대: 0 · 0 · 0

-- ============================================================
-- 위 §1 건수와 §6 잔여를 확인한 뒤, 아래 주석을 풀어 실행할 것.
-- 틀리면 대신 ROLLBACK; 을 실행한다.
--
-- COMMIT;
-- ============================================================
