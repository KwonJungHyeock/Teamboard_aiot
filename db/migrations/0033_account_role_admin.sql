-- MD-P-2026-035 §B — 역할에 `admin` 을 더한다 (관리자 등급 신설)
--
-- ── 무엇을 하는가 ────────────────────────────────────────────────
--
-- **값 목록만 넓힌다.** 데이터를 옮기지 않는다. 이 파일이 도는 시점에
-- `role='admin'` 인 계정은 0 건이고, 누구를 관리자로 올릴지는 **화면에서**
-- 하는 데이터 작업이다. 시드나 마이그레이션에 사람 이름을 넣지 않는다
-- (§G — 이름으로 판정하지 않는다 · 지시서가 규칙을 어기면 지시서가 틀린 것이다).
--
-- ── 실행 전 확인 (§A 착수 체크리스트) ────────────────────────────
--
-- `account` 제약 전량을 먼저 조회했다. 부딪히는 것은 없다.
--
--   CHECK   account_role_check   role IN ('lead','member','viewer')   ← 이것만 넓힌다
--   FK      account_actor_id_fkey → actor(id)
--   PK      account_pkey (actor_id)
--   UNIQUE  account_email_key (email)
--
-- ── 왜 DROP 후 ADD 인가 ──────────────────────────────────────────
--
-- CHECK 제약은 제자리에서 넓힐 수 없다. 지우고 다시 만든다.
-- 그 사이 아주 짧게 제약이 없는 순간이 있지만 **같은 트랜잭션 안**이라
-- (러너가 파일마다 BEGIN/COMMIT 으로 감싼다) 밖에서는 보이지 않는다.
--
-- 되돌리기: db/migrations/rollback/0033_account_role_admin_down.sql

ALTER TABLE account DROP CONSTRAINT IF EXISTS account_role_check;
ALTER TABLE account ADD CONSTRAINT account_role_check
  CHECK (role = ANY (ARRAY['admin', 'lead', 'member', 'viewer']));
