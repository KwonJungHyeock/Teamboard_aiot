-- MD-P-2026-038 §B-1 — 에이전트 흔적 집계 (Neon 에서 한 번 돌린다)
--
-- **읽기 전용이다. UPDATE·DELETE 가 한 줄도 없다.**
--
-- 철거 범위는 정해졌지만 **프로덕션에 무엇이 몇 건 있는지 아직 아무도 안 봤다.**
-- 모르는 채로 지우는 것은 되돌릴 수 없는 판단이다. 그래서 지우기 전에 센다.
--
-- 숫자만 보면 그 숫자가 지워도 되는 것인지 모른다. 그래서 아래 둘은 **목록**까지 낸다.
--   · `task(origin='agent')` — 사람이 이어받아 진행 중일 수 있다
--   · `drafts`               — 사람이 아직 판단하지 않은 것이 남아 있을 수 있다
--
-- 같은 값을 화면에서도 볼 수 있다 — /admin/agent-usage (관리자 전용, 읽기 전용).

\echo '=== 건수 ==='
SELECT '에이전트 actor'        AS 항목, count(*)::text AS 건수 FROM actor  WHERE type = 'agent'
UNION ALL SELECT 'agent_config',        count(*)::text FROM agent_config
UNION ALL SELECT 'agent_job',           count(*)::text FROM agent_job
UNION ALL SELECT '승인 대기 초안(drafts)', count(*)::text FROM drafts
UNION ALL SELECT '에이전트가 만든 업무',   count(*)::text FROM task WHERE origin = 'agent'
UNION ALL SELECT '제안 상태 업무',        count(*)::text FROM task WHERE status = 'proposed';

\echo ''
\echo '=== 무엇인가 (지워도 되는지 판단하는 데 필요한 설명) ==='
\echo '  에이전트 actor        계정 발급 시 자동 생성. 캘린더 레인이 여기서 늘어난다'
\echo '  agent_config          에이전트별 설정(보고 형식·담당 영역·자동 범위·추가 지시문)'
\echo '  agent_job             에이전트가 돌린 작업 기록. 0이면 한 번도 안 돌았다'
\echo '  drafts                부사수가 만든 승인 대기 초안. 사람이 아직 판단 안 한 것이 있을 수 있다'
\echo '  origin=agent 업무     에이전트가 만든 업무. 사람이 이어받아 진행 중일 수 있다 — 아래 목록을 볼 것'
\echo '  proposed 업무         승인 인박스에 뜨는 제안 상태'

\echo ''
\echo '=== 에이전트가 만든 업무 — 전량 목록 ==='
SELECT t.id, t.title AS 업무, COALESCE(ac.display_name, '—') AS 담당,
       t.created_at::date AS 만든날, t.status AS 상태, t.is_active AS 활성
  FROM task t
  LEFT JOIN actor ac ON ac.id = t.assignee_id
 WHERE t.origin = 'agent'
 ORDER BY t.created_at DESC, t.id;

\echo ''
\echo '=== 승인 대기 초안 — 전량 목록 ==='
SELECT d.id, COALESCE(d.title, '(제목 없음)') AS 제목,
       COALESCE(ac.display_name, '—') AS 만든사람,
       d.created_at::date AS 만든날, d.status AS 상태
  FROM drafts d
  LEFT JOIN actor ac ON ac.id = d.user_id
 ORDER BY d.created_at DESC, d.id;

\echo ''
\echo '=== 참고 — 에이전트 actor 목록 (캘린더 레인이 이만큼 줄어든다) ==='
SELECT a.id, a.display_name AS 이름, a.is_active AS 활성,
       COALESCE(o.display_name, '—') AS 주인
  FROM actor a
  LEFT JOIN actor o ON o.id = a.owner_actor_id
 WHERE a.type = 'agent'
 ORDER BY a.id;
