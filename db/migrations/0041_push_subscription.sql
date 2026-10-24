-- 데스크톱 알림(웹 푸시) — 알림을 받을 기기 (2026-10 알림 A: 앱 설치 + 데스크톱 알림).
--
-- ── 무엇인가 ─────────────────────────────────────────────────────
--
-- 브라우저가 「이 기기로 알림을 보내려면 여기로」라고 준 주소(endpoint)와 암호 키 둘.
-- 사람 한 명이 기기 여럿(회사 데스크톱 · 노트북)을 가질 수 있다. 같은 주소는 한 행.
--
--   kinds   이 기기에서 받을 알림: assign(나에게 업무) · meeting(회의 시작) · due(아침 마감)
--
-- ── 죽은 기기 ──────────────────────────────────────────────────────
-- 푸시 서버가 404 · 410 을 주면 그 기기는 구독을 버린 것이다 — `disabled_at` 을 찍고
-- 다시 안 보낸다(지우지 않는다: 언제 끊겼는지가 남는다). 다른 실패는 `fail_count` 만 센다.
--
-- 되돌리기: db/migrations/rollback/0041_push_subscription_down.sql

CREATE TABLE IF NOT EXISTS push_subscription (
  id           SERIAL PRIMARY KEY,
  actor_id     INTEGER     NOT NULL REFERENCES actor(id),
  endpoint     TEXT        NOT NULL,
  p256dh       TEXT        NOT NULL,
  auth         TEXT        NOT NULL,
  kinds        TEXT[]      NOT NULL DEFAULT ARRAY['assign', 'meeting', 'due'],
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at   TIMESTAMPTZ,
  fail_count   INTEGER     NOT NULL DEFAULT 0,
  disabled_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_endpoint ON push_subscription (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_actor ON push_subscription (actor_id) WHERE disabled_at IS NULL;
ALTER TABLE push_subscription DROP CONSTRAINT IF EXISTS push_subscription_kinds_check;
ALTER TABLE push_subscription ADD CONSTRAINT push_subscription_kinds_check
  CHECK (kinds <@ ARRAY['assign', 'meeting', 'due']);
