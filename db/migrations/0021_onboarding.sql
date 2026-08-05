-- 첫 사용 안내 (MD-P-2026-015 §A, add-only)
-- "첫 로그인 시 1회"를 브라우저가 아니라 계정 기준으로 판단한다.
-- localStorage 를 쓰면 기기·브라우저를 바꿀 때마다 다시 뜨므로 서버에 남긴다.
-- NULL = 아직 안 봤음. 값이 있으면 그 시각에 확인(또는 건너뛰기)한 것.
ALTER TABLE account ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
