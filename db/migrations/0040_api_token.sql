-- Claude 연결 키 — 각자 자기 Claude(데스크톱 · Claude Code)를 팀보드에 잇는다 (2026-10 Claude 연동).
--
-- ── 무엇인가 ─────────────────────────────────────────────────────
--
-- 「내 정보」에서 만드는 **개인 키**다. Claude 가 이 키를 들고 `/api/mcp` 를 부르면
-- 그 사람으로서 내 기록 · 내 업무를 적고 읽는다. 키 하나 = 사람 하나.
--
-- ── 키 자체는 저장하지 않는다 ─────────────────────────────────────
--
-- `token_hash` 는 sha256 이다. 키는 만들 때 **한 번만** 화면에 보이고 DB 에는 없다.
-- DB 가 새도 키를 되살릴 수 없다. 보여 줄 때는 앞 몇 글자(`prefix`)만 쓴다.
--
-- ── 끄기 ─────────────────────────────────────────────────────────
-- 지우지 않고 `revoked_at` 을 찍는다 — 언제 끊었는지가 남는다. 끊긴 키는 바로 401.
-- 계정이 비활성이 되면 키도 같이 막힌다(조회할 때 계정을 함께 본다).
--
-- 되돌리기: db/migrations/rollback/0040_api_token_down.sql

CREATE TABLE IF NOT EXISTS api_token (
  id            SERIAL PRIMARY KEY,
  actor_id      INTEGER     NOT NULL REFERENCES actor(id),
  name          TEXT        NOT NULL,
  token_hash    TEXT        NOT NULL,
  prefix        TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
ALTER TABLE api_token DROP CONSTRAINT IF EXISTS api_token_name_check;
ALTER TABLE api_token ADD CONSTRAINT api_token_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_token_hash ON api_token (token_hash);
CREATE INDEX IF NOT EXISTS idx_api_token_actor ON api_token (actor_id) WHERE revoked_at IS NULL;
