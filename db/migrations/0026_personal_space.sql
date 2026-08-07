-- MD-P-2026-025 §C·§D — 개인 메모 · 개인 일정.
--
-- 둘 다 **항상 개인이다.** 공개 옵션을 만들지 않는다(§C).
-- 공유가 필요하면 논의나 캔버스로 간다 — 여기에 공개 스위치를 달면
-- 다시 "이걸 올리면 남들이 보나?"를 판단해야 한다. 그게 이번 지시가 없애려는 것이다.
--
-- 그래서 task 처럼 visibility 컬럼을 두지 않는다. 소유자(owner_actor_id)만 있으면 된다.
-- 값이 하나뿐인 컬럼은 규칙이 아니라 장식이다.
--
-- 롤백: db/migrations/rollback/0026_personal_space_down.sql

-- ── 개인 메모 (§C) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note (
  id             SERIAL PRIMARY KEY,
  owner_actor_id INTEGER     NOT NULL REFERENCES actor(id),
  title          TEXT        NOT NULL DEFAULT '',
  -- 본문은 문서형 업무(task.doc)와 같은 블록 배열이다. 편집기를 그대로 재사용한다.
  body           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 목록은 "내 메모, 최근 수정 순"이 유일한 접근 패턴이다.
CREATE INDEX IF NOT EXISTS idx_note_owner ON note (owner_actor_id, updated_at DESC);

-- ── 개인 일정 (§D) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_event (
  id             SERIAL PRIMARY KEY,
  owner_actor_id INTEGER     NOT NULL REFERENCES actor(id),
  title          TEXT        NOT NULL,
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ,
  all_day        BOOLEAN     NOT NULL DEFAULT false,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 끝나는 시각이 시작보다 앞설 수 없다. 다일 일정 스팬 계산이 뒤집히면 화면이 깨진다.
ALTER TABLE personal_event DROP CONSTRAINT IF EXISTS personal_event_range_check;
ALTER TABLE personal_event ADD CONSTRAINT personal_event_range_check
  CHECK (ends_at IS NULL OR ends_at >= starts_at);

-- 캘린더는 "내 일정, 이 기간" 으로만 읽는다.
CREATE INDEX IF NOT EXISTS idx_personal_event_owner
  ON personal_event (owner_actor_id, starts_at);
