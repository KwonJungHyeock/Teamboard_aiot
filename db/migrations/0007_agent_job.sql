-- 에이전트 FAB — 우측 하단 상시 에이전트에 위임한 작업 큐.
-- 1인 1에이전트 원칙: user_id(사람 actor) 기준. 결과는 승인 대기(초안 pending)로 등록되어
--   사람이 확정한다(자동 확정 없음). draft_id로 생성된 초안을 연결한다.
-- 이미지·대용량은 저장하지 않는다(결과 텍스트만). 비파괴 추가.
CREATE TABLE IF NOT EXISTS agent_job (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES actor(id),
  prompt      TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'research' CHECK (type IN ('research', 'organize')),
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  result      TEXT,                       -- 완료 시 결과 요약(초안 본문 발췌). 상세는 연결된 초안에.
  error       TEXT,                       -- 실패 사유(크레딧 부족·모델 오류 등) — graceful 표시용
  draft_id    INTEGER REFERENCES drafts(id),  -- 완료 시 등록된 승인 대기 초안
  cost_tokens INTEGER NOT NULL DEFAULT 0, -- 소비 토큰(추정) — 월 크레딧 집계 기준
  seen_at     TIMESTAMPTZ,                -- 완료 알림 확인 시각(FAB 배지 해제)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_job_user_idx ON agent_job (user_id, created_at DESC);
