-- MD-P-2026-024 회신 8 [지시 25] — 중복 조사 (지시 18 + 24-1 통합)
--
-- **읽기 전용입니다.** SELECT 만 씁니다. INSERT/UPDATE/DELETE/DDL 이 한 줄도 없습니다.
-- 실행은 사용자가 Neon 콘솔 Query 창에서 직접 합니다 (회신 3 [지시 14-6]).
--
-- 섹션 A / B / C 는 서로 독립입니다. 필요한 섹션만 잘라 붙여 실행해도 됩니다.
-- id 는 **프로덕션 기준**입니다. 로컬 복제본에서 돌리면 다른 행이 나옵니다.
--
-- 읽는 법
--   A. 중복 의심 업무 5건의 신원 — 누가·언제·어디에 만들었는가
--   B. 목표 4건의 신원 — 생성 시각이 초 단위로 붙어 있으면 자동 생성 의심,
--      몇 분~며칠 흩어져 있으면 사람이 만든 것
--   C. 목표 제목이 겹치는 쌍 전체 — A·B 밖에 더 있는지


-- ══════════════════════════════════════════════════════════════════
-- 섹션 A — 중복 의심 업무 #32 · #38 · #42 · #17 · #26
-- ══════════════════════════════════════════════════════════════════
SELECT
  t.id,
  t.title,
  left(coalesce(t.description, ''), 200)              AS description_200,
  t.created_at,
  ca.display_name                                    AS created_by,
  t.project_id,
  p.name                                             AS project_name,
  -- 연결된 목표는 여러 개일 수 있다. 한 줄로 모아 본다.
  (SELECT string_agg(g.id || ':' || g.title, ' | ' ORDER BY g.id)
     FROM goal_task gt JOIN goal g ON g.id = gt.goal_id
    WHERE gt.task_id = t.id)                         AS linked_goals,
  t.goal_source,
  t.status,
  t.resolution,
  t.progress,
  t.due_date,
  (SELECT count(*) FROM task_comment c WHERE c.task_id = t.id)::int AS comment_count,
  t.is_active
FROM task t
LEFT JOIN actor   ca ON ca.id = t.created_by
LEFT JOIN project p  ON p.id  = t.project_id
WHERE t.id IN (32, 38, 42, 17, 26)
ORDER BY t.title, t.created_at;


-- ══════════════════════════════════════════════════════════════════
-- 섹션 B — 목표 #13 · #14 · #15 · #17
--
--   created_gap_sec = 같은 제목 목표들 사이의 생성 간격(초).
--   0~2초면 한 번의 실행이 여러 건을 만든 것 — 자동 생성 의심.
-- ══════════════════════════════════════════════════════════════════
-- 창(window)은 **목표 전체**에서 계산한 뒤 4건만 걸러낸다.
-- WHERE 로 먼저 좁히면 "같은 제목" 비교 대상이 이 4건 안으로 갇혀 항상 0 이 나온다.
WITH t AS (
  SELECT
    g.*,
    round(extract(epoch FROM (
      g.created_at - min(g.created_at) OVER (PARTITION BY btrim(g.title))
    )))::int                                         AS created_gap_sec,
    count(*)      OVER (PARTITION BY btrim(g.title))::int AS same_title_n
  FROM goal g
)
SELECT
  t.id,
  t.title,
  t.period_type,
  t.period_start,
  t.period_end,
  t.parent_id                                        AS parent_goal_id,
  pg.title                                           AS parent_title,
  t.created_at,
  -- goal 에는 created_by 가 없다. 소유자(owner_actor_id)가 가장 가까운 대체값이다.
  -- 팀 목표는 소유자가 비어 있는 것이 정상이다.
  oa.display_name                                    AS owner,
  t.scope,
  t.is_active,
  t.same_title_n,        -- 같은 제목 목표가 전체에 몇 건인가
  t.created_gap_sec      -- 그중 가장 먼저 만들어진 것과의 간격(초)
FROM t
LEFT JOIN goal  pg ON pg.id = t.parent_id
LEFT JOIN actor oa ON oa.id = t.owner_actor_id
WHERE t.id IN (13, 14, 15, 17)
ORDER BY t.title, t.created_at;


-- ══════════════════════════════════════════════════════════════════
-- 섹션 C — 제목이 중복되는 목표 쌍 전체 (보관된 것 포함)
--
--   앞뒤 공백만 제거해 비교합니다. 대소문자·괄호는 건드리지 않습니다 —
--   "비슷하다"를 기계가 판단하면 실제와 다른 묶음이 나옵니다.
--   span_sec 이 작을수록 한 번에 만들어진 것입니다.
-- ══════════════════════════════════════════════════════════════════
SELECT
  btrim(g.title)                                     AS title,
  count(*)::int                                      AS n,
  array_agg(g.id            ORDER BY g.created_at)   AS ids,
  array_agg(g.period_type   ORDER BY g.created_at)   AS period_types,
  array_agg(g.period_start  ORDER BY g.created_at)   AS period_starts,
  array_agg(g.created_at    ORDER BY g.created_at)   AS created_ats,
  array_agg(coalesce(oa.display_name, '(팀)')
                            ORDER BY g.created_at)   AS owners,
  array_agg(g.is_active     ORDER BY g.created_at)   AS actives,
  round(extract(epoch FROM (max(g.created_at) - min(g.created_at))))::int AS span_sec
FROM goal g
LEFT JOIN actor oa ON oa.id = g.owner_actor_id
GROUP BY btrim(g.title)
HAVING count(*) > 1
ORDER BY span_sec, title;
