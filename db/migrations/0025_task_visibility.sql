-- MD-P-2026-025 §A2 — 업무에 공개 범위를 준다.
--
-- 지금은 무언가 적을 때마다 "이걸 올리면 남들이 보나?"를 판단해야 한다.
-- 그 불확실성이 기록 자체를 막는다. 경계를 데이터에 새긴다.
--
--   team    — 팀 전체가 본다 (기존 동작, 기본값)
--   private — 본인만 본다. 팀장도 못 본다.
--
-- 비파괴: ADD COLUMN + backfill 만. 기존 행은 전부 'team' 이다 — 추정하지 않는다.
-- 롤백: db/migrations/rollback/0025_task_visibility_down.sql

-- ── 1. 컬럼 ─────────────────────────────────────────────────────────
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'team';

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_visibility_check;
ALTER TABLE task ADD CONSTRAINT task_visibility_check
  CHECK (visibility IN ('team', 'private'));

-- ── 2. backfill ─────────────────────────────────────────────────────
-- DEFAULT 가 이미 'team' 이라 기존 행도 'team' 이다. 명시적으로 한 번 더 못박는다.
-- **어떤 업무가 개인이었는지 추정하지 않는다.** 개인은 사람이 고르는 것이다.
UPDATE task SET visibility = 'team' WHERE visibility IS NULL;

-- ── 3. 제약 — private 는 프로젝트에 속할 수 없다 ─────────────────────
-- 프로젝트는 팀 단위다. 개인 업무가 프로젝트에 들어가면 프로젝트 상세·진척·
-- 목표 롤업을 통해 팀에게 새어 나간다. 컬럼 두 개로 끝나는 문제라 CHECK 로 막는다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_private_no_project;
ALTER TABLE task ADD CONSTRAINT task_private_no_project
  CHECK (visibility <> 'private' OR project_id IS NULL);

-- ── 4. 소유자 ───────────────────────────────────────────────────────
-- 지시서는 인덱스를 (owner_actor_id, visibility) 로 적었으나 task 에 owner_actor_id 는
-- **없다.** 있는 것은 created_by 와 assignee_id 뿐이다(완료보고 [기준과 다르게] 참조).
-- 개인 업무의 주인은 **만든 사람(created_by)** 으로 정한다. 담당은 바뀔 수 있지만
-- "이건 내 것"의 기준은 바뀌면 안 되기 때문이다.
--
-- 따라서 private 업무를 남에게 배정할 수 없다 — 배정하면 그 사람은 자기에게
-- 배정된 업무를 볼 수 없는 상태가 된다. 트리거로 막는다.
-- (CHECK 로는 못 쓴다: assignee_id 가 NULL 인 경우를 허용해야 하고,
--  두 컬럼 비교는 CHECK 로도 되지만 사유 메시지를 주려면 트리거가 낫다)
CREATE OR REPLACE FUNCTION task_private_owner_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.visibility = 'private'
     AND NEW.assignee_id IS NOT NULL
     AND NEW.assignee_id IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION '개인 업무는 다른 사람에게 배정할 수 없습니다 (업무 %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_private_owner ON task;
CREATE TRIGGER trg_task_private_owner BEFORE INSERT OR UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION task_private_owner_guard();

-- ── 5. 인덱스 ───────────────────────────────────────────────────────
-- "내 개인 업무" 조회가 가장 잦은 접근이다.
CREATE INDEX IF NOT EXISTS idx_task_owner_visibility ON task (created_by, visibility);
-- 목록 쿼리는 거의 전부 "visibility='team' 또는 내 것" 형태라 부분 인덱스가 붙는다.
CREATE INDEX IF NOT EXISTS idx_task_private ON task (created_by) WHERE visibility = 'private';
