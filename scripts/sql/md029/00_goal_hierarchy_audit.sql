-- MD-P-2026-029 §A6 — 목표 계층 실태 감사 (프로덕션용)
--
-- **읽기 전용입니다. 아무것도 바꾸지 않습니다.** SELECT 뿐입니다.
-- Neon 콘솔 Query 창에 그대로 붙여 실행하세요.
--
-- 왜 SQL 로 따로 내는가.
--   로컬 시드로는 프로덕션 실태를 볼 수 없습니다. 이번이 그 사례였습니다 —
--   로컬 2026 Q3 분기 목표는 2개인데 프로덕션은 4개였고,
--   그 차이 때문에 "기간이 계층을 결정한다"는 설계가 성립하지 않았습니다.
--
-- 보는 법.
--   후보수 = 이 목표의 기간이 가리키는 상위 후보가 몇 개인가.
--     0  → 상위가 될 목표가 아예 없다 (§A2 "함께 만들까요?" 가 뜨는 경우)
--     1  → 기간만으로 하나로 좁혀진다 (자동 귀속이 안전한 경우)
--     2+ → 기간만으로는 못 정한다. 만든 자리(placed)나 선택이 필요하다
--   상위일치 = 지금 붙어 있는 상위가 그 후보 안에 있는가.
--     'N (어긋남)' 이면 기간과 상위가 맞지 않는다는 뜻입니다.
--     **다만 이것이 곧 오류는 아닙니다** — placed/manual 로 일부러 그렇게 둔 것일 수 있습니다.

WITH g AS (
  SELECT
    goal.id,
    goal.title,
    goal.period_type,
    goal.period_start,
    goal.scope,
    goal.owner_actor_id,
    goal.parent_id,
    -- goal_parent_source 는 0028 이후에만 존재합니다. 아직 안 나갔으면 NULL 로 나옵니다.
    to_jsonb(goal) ->> 'goal_parent_source' AS parent_source,
    -- 이 기간이 가리키는 상위의 주기와 시작일
    CASE goal.period_type
      WHEN 'month'   THEN 'quarter'
      WHEN 'quarter' THEN 'year'
    END AS want_type,
    CASE goal.period_type
      WHEN 'month'   THEN date_trunc('quarter', goal.period_start)::date
      WHEN 'quarter' THEN date_trunc('year',    goal.period_start)::date
    END AS want_start
  FROM goal
  WHERE goal.is_active = true
)
SELECT
  g.id                                        AS "id",
  g.title                                     AS "제목",
  g.period_type                               AS "주기",
  g.period_start                              AS "기간시작",
  g.scope                                     AS "scope",
  g.owner_actor_id                            AS "소유자",
  g.parent_id                                 AS "현재상위id",
  p.title                                     AS "현재상위제목",
  p.period_type                               AS "현재상위주기",
  p.period_start                              AS "현재상위기간",
  COALESCE(g.parent_source, '(컬럼없음)')      AS "상위출처",
  -- 같은 기간의 상위 후보 수. 스코프까지 맞아야 후보다 —
  -- 개인 목표는 같은 사람의 개인 목표에만 붙을 수 있습니다.
  COALESCE((
    SELECT count(*) FROM goal c
     WHERE c.is_active = true
       AND c.period_type = g.want_type
       AND c.period_start = g.want_start
       AND c.scope = g.scope
       AND (g.scope <> 'personal' OR c.owner_actor_id = g.owner_actor_id)
  ), 0)                                       AS "후보수",
  COALESCE((
    SELECT string_agg('#' || c.id || ' ' || c.title, ' / ' ORDER BY c.id) FROM goal c
     WHERE c.is_active = true
       AND c.period_type = g.want_type
       AND c.period_start = g.want_start
       AND c.scope = g.scope
       AND (g.scope <> 'personal' OR c.owner_actor_id = g.owner_actor_id)
  ), '(없음)')                                 AS "기간기준후보",
  CASE
    WHEN g.period_type = 'year' THEN '—'
    WHEN g.parent_id IS NULL    THEN 'N (상위 없음)'
    WHEN EXISTS (
      SELECT 1 FROM goal c
       WHERE c.id = g.parent_id
         AND c.period_type = g.want_type
         AND c.period_start = g.want_start
    )                           THEN 'Y'
    ELSE 'N (어긋남)'
  END                                          AS "상위일치"
FROM g
LEFT JOIN goal p ON p.id = g.parent_id
ORDER BY
  CASE g.period_type WHEN 'year' THEN 1 WHEN 'quarter' THEN 2 ELSE 3 END,
  g.period_start,
  g.id;

-- ── 요약 한 줄 (위 결과와 별개로 한 번 더 돌리세요) ──────────────────
-- 후보가 2개 이상인 목표가 몇 건인지 = "기간만으로는 못 정하는" 목표가 몇 건인지.
--
-- SELECT period_type AS 주기, count(*) AS 건수
--   FROM goal WHERE is_active = true GROUP BY period_type ORDER BY 1;
--
-- SELECT period_start AS 분기시작, count(*) AS 분기목표수
--   FROM goal WHERE is_active = true AND period_type = 'quarter'
--  GROUP BY period_start ORDER BY 1;
