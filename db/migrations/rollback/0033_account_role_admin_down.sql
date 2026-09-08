-- MD-P-2026-035 §B — 0033 되돌리기
--
-- ⚠ **`admin` 인 계정이 하나라도 있으면 이 되돌리기는 실패합니다.**
--    되돌리기 전 전원을 `lead` 로 내리십시오.
--
-- 먼저 세십시오. 0 이 아니면 아래 ALTER 가 거부됩니다.
--
--   SELECT count(*) FROM account WHERE role = 'admin';   -- 0 이어야 한다
--
-- 0 이 아니라면 내린 뒤에 되돌립니다. **누구를 내렸는지 적어 두십시오** —
-- 다시 올릴 때 그 목록이 유일한 근거입니다.
--
--   SELECT a.display_name, ac.email FROM account ac JOIN actor a ON a.id = ac.actor_id
--    WHERE ac.role = 'admin';                            -- 보관할 것
--   UPDATE account SET role = 'lead' WHERE role = 'admin';
--
-- ── 되돌리기 시한 ────────────────────────────────────────────────
--
-- **두지 않습니다.** 값 목록을 넓혔을 뿐 데이터를 만들지도 옮기지도 않았습니다.
-- 시계를 시작할 이유가 없습니다 (0032 와 같은 판단 · 0029~0031 과 다른 점).
-- 다만 위 확인은 시한과 무관하게 **매번** 필요합니다.
--
-- `schema_migrations` 에서 줄을 **지우지 않습니다**(RUNBOOK 규약).
-- 다시 적용해야 하면 **새 번호로 정방향 마이그레이션을 씁니다.**

ALTER TABLE account DROP CONSTRAINT IF EXISTS account_role_check;
ALTER TABLE account ADD CONSTRAINT account_role_check
  CHECK (role = ANY (ARRAY['lead', 'member', 'viewer']));
