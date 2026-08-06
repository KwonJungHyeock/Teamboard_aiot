-- MD-P-2026-024 [2] 업무 구조 기반 공사 — 마이그레이션 1회로 끝낸다.
-- 하위 업무 · 절대 순서 · 완료 사유 · 차단 관계 · 목표 상속을 한 번에 깐다.
-- 이후 지시(하위 업무 UI, 차단 UI, 백로그 정렬, GitHub 연동)가 전부 이 컬럼을 쓴다.
--
-- 비파괴: ADD COLUMN + backfill 만. 기존 컬럼(blocked / blocked_reason / blocked_since)은
-- 지시대로 남긴다 — 자유 서술 차단 사유가 필요한 경우가 있다.
-- 롤백: db/migrations/rollback/0023_task_structure_down.sql

-- ── 1. 컬럼 ─────────────────────────────────────────────────────────
-- blocked_by(int, FK→task) 는 이미 존재한다. 지시서의 blocked_by_task_id 와 같은 역할이므로
-- 중복 컬럼을 만들지 않고 기존 컬럼을 그대로 쓴다. (완료보고 [기준과 다르게] 참조)
ALTER TABLE task
  ADD COLUMN IF NOT EXISTS parent_task_id int REFERENCES task(id),
  ADD COLUMN IF NOT EXISTS sort_order     int,
  ADD COLUMN IF NOT EXISTS resolution     text,
  ADD COLUMN IF NOT EXISTS goal_source    text NOT NULL DEFAULT 'inherited';

-- ── 2. backfill ─────────────────────────────────────────────────────
-- sort_order: 형제(같은 프로젝트) 안에서 생성 순서. 프로젝트 없는 업무는 한 묶음으로 본다.
UPDATE task SET sort_order = s.rn
  FROM (
    SELECT id, (row_number() OVER (PARTITION BY coalesce(project_id, 0)
                                   ORDER BY created_at, id))::int AS rn
    FROM task
  ) s
 WHERE task.id = s.id AND task.sort_order IS NULL;

ALTER TABLE task ALTER COLUMN sort_order SET DEFAULT 0;
ALTER TABLE task ALTER COLUMN sort_order SET NOT NULL;

-- goal_source: 이미 목표가 손으로 연결된 업무는 manual 로 고정한다.
-- (프로젝트 목표가 바뀌어도 기존 연결이 저절로 움직이면 안 된다 — 놀람 방지)
UPDATE task SET goal_source = 'manual'
 WHERE EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = task.id);

-- parent_task_id / resolution 은 backfill 하지 않는다. 지시대로 추정 금지.

-- ── 3. 제약 ─────────────────────────────────────────────────────────
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_resolution_check;
ALTER TABLE task ADD CONSTRAINT task_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('done', 'canceled', 'duplicate', 'deferred'));

-- resolution 은 상태가 완료일 때만 값을 갖는다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_resolution_only_done;
ALTER TABLE task ADD CONSTRAINT task_resolution_only_done
  CHECK (resolution IS NULL OR status = 'done');

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_goal_source_check;
ALTER TABLE task ADD CONSTRAINT task_goal_source_check
  CHECK (goal_source IN ('inherited', 'manual'));

-- 자기 자신을 부모/차단자로 둘 수 없다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS task_parent_not_self;
ALTER TABLE task ADD CONSTRAINT task_parent_not_self
  CHECK (parent_task_id IS NULL OR parent_task_id <> id);

ALTER TABLE task DROP CONSTRAINT IF EXISTS task_blocked_by_not_self;
ALTER TABLE task ADD CONSTRAINT task_blocked_by_not_self
  CHECK (blocked_by IS NULL OR blocked_by <> id);

-- ── 4. 인덱스 ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_task_parent       ON task (parent_task_id);
CREATE INDEX IF NOT EXISTS idx_task_blocked_by   ON task (blocked_by);
CREATE INDEX IF NOT EXISTS idx_task_project_sort ON task (project_id, sort_order);

-- ── 5. 깊이 2단 고정 ────────────────────────────────────────────────
-- 부모가 있는 업무는 다시 부모가 될 수 없다.
-- (전체 트리는 목표 → 프로젝트 → 업무 → 하위 업무 4단에서 멈춘다)
CREATE OR REPLACE FUNCTION task_depth_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    -- 내가 붙으려는 부모가 이미 누군가의 하위라면 3단이 된다.
    IF EXISTS (SELECT 1 FROM task p
                WHERE p.id = NEW.parent_task_id AND p.parent_task_id IS NOT NULL) THEN
      RAISE EXCEPTION '하위 업무는 다시 상위가 될 수 없습니다 (깊이 2단 고정): task % → parent %',
        NEW.id, NEW.parent_task_id USING ERRCODE = 'check_violation';
    END IF;
    -- 나에게 이미 하위가 있으면 나는 누군가의 하위가 될 수 없다.
    IF EXISTS (SELECT 1 FROM task c WHERE c.parent_task_id = NEW.id) THEN
      RAISE EXCEPTION '하위 업무를 가진 업무는 다른 업무의 하위가 될 수 없습니다 (깊이 2단 고정): task %',
        NEW.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_depth_guard ON task;
CREATE TRIGGER trg_task_depth_guard
  BEFORE INSERT OR UPDATE OF parent_task_id ON task
  FOR EACH ROW EXECUTE FUNCTION task_depth_guard();

-- ── 6. 차단 순환 금지 ───────────────────────────────────────────────
-- blocked_by 를 따라가다 자기 자신으로 돌아오면 거부한다.
CREATE OR REPLACE FUNCTION task_block_cycle_guard() RETURNS trigger AS $$
DECLARE
  cur  int := NEW.blocked_by;
  hops int := 0;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION '차단 관계가 순환합니다 — task % 를 차단자로 지정할 수 없습니다', NEW.blocked_by
        USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 1000 THEN   -- 기존 데이터에 이미 순환이 있어도 무한루프에 빠지지 않는다
      RAISE EXCEPTION '차단 관계 추적이 너무 깊습니다 (순환 의심): task %', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT t.blocked_by INTO cur FROM task t WHERE t.id = cur;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_block_cycle ON task;
CREATE TRIGGER trg_task_block_cycle
  BEFORE INSERT OR UPDATE OF blocked_by ON task
  FOR EACH ROW WHEN (NEW.blocked_by IS NOT NULL)
  EXECUTE FUNCTION task_block_cycle_guard();

-- blocked_by 가 채워지면 blocked 를 true 로 파생한다.
-- 수동 입력(자유 서술 사유)은 그대로 병행 — blocked_by 를 지운다고 blocked 를 끄지 않는다.
CREATE OR REPLACE FUNCTION task_blocked_derive() RETURNS trigger AS $$
BEGIN
  IF NEW.blocked_by IS NOT NULL AND NOT NEW.blocked THEN
    NEW.blocked := true;
    IF NEW.blocked_since IS NULL THEN NEW.blocked_since := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_blocked_derive ON task;
CREATE TRIGGER trg_task_blocked_derive
  BEFORE INSERT OR UPDATE OF blocked_by ON task
  FOR EACH ROW EXECUTE FUNCTION task_blocked_derive();

-- ── 7. 하위 업무가 있는 상위 업무 삭제 금지 ─────────────────────────
-- 하드 삭제를 DB 층에서 막는다. 소프트 삭제(is_active=false)는 API 층에서 막는다.
CREATE OR REPLACE FUNCTION task_delete_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM task c WHERE c.parent_task_id = OLD.id) THEN
    RAISE EXCEPTION '하위 업무가 있는 업무는 삭제할 수 없습니다 — 하위를 먼저 처리하세요 (task %)', OLD.id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_delete_guard ON task;
CREATE TRIGGER trg_task_delete_guard
  BEFORE DELETE ON task
  FOR EACH ROW EXECUTE FUNCTION task_delete_guard();
