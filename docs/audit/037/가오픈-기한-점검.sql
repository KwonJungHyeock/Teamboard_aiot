-- MD-P-2026-037 §B — 가오픈 기준 기한 점검 (Neon 에서 한 번 돌린다)
--
-- **읽기 전용이다. 아무것도 바꾸지 않는다.**
-- 기한을 옮기는 UPDATE 는 여기 없다 — 조정은 화면에서 사람이 한다.
--
-- ── 세 갈래로 센다 ───────────────────────────────────────────────
--
--   ① 기한이 가오픈일 이전   정상
--   ② 기한이 가오픈일 이후   어긋남
--   ③ **기한이 아예 없음**   ②보다 위험하다
--
-- ③을 빠뜨리면 안 된다. 기한이 늦은 업무는 늦은 게 보이지만, 기한이 없는 업무는
-- **아무 날에도 안 걸려서 마지막까지 안 보인다.**
--
-- 완료(`status='done'`)는 세 갈래 전부에서 뺀다. 섞으면 「가오픈 뒤 12건」이
-- 실제로는 이미 끝난 것들인데도 손대야 할 것처럼 보인다.
-- 대신 **몇 건을 뺐는지 함께 낸다** — 안 적으면 총합이 안 맞아 보인다.
--
-- 가오픈일은 `config` 에서 읽는다. 값이 없으면 자료 기준값을 쓴다 —
-- 화면(/settings)에서 바꾼 날짜가 여기에도 그대로 반영된다.

\echo '=== 기준 가오픈일 ==='
SELECT COALESCE(
         (SELECT value #>> '{}' FROM config WHERE key = 'platform_open_at'),
         '2026-11-02T00:00:00+09:00'
       )::timestamptz AT TIME ZONE 'Asia/Seoul' AS 가오픈_KST;

\echo ''
\echo '=== ① ② ③ 집계 (완료 제외) ==='
WITH o AS (
  SELECT (COALESCE((SELECT value #>> '{}' FROM config WHERE key = 'platform_open_at'),
                   '2026-11-02T00:00:00+09:00')::timestamptz
          AT TIME ZONE 'Asia/Seoul')::date AS d
)
SELECT CASE
         WHEN t.due_date IS NULL                     THEN '③ 기한 없음'
         WHEN t.due_date <= (SELECT d FROM o)        THEN '① 가오픈 이전'
         ELSE                                             '② 가오픈 이후'
       END AS 갈래,
       count(*) AS 건수
  FROM task t
 WHERE t.is_active AND t.status <> 'done'
 GROUP BY 1
 ORDER BY 1;

\echo ''
\echo '=== 세 갈래에서 뺀 완료 업무 (총합이 맞는지 보는 값) ==='
SELECT count(*) AS 완료제외 FROM task WHERE is_active AND status = 'done';

\echo ''
\echo '=== ② 기한이 가오픈일 이후 — 조정 대상 목록 ==='
WITH o AS (
  SELECT (COALESCE((SELECT value #>> '{}' FROM config WHERE key = 'platform_open_at'),
                   '2026-11-02T00:00:00+09:00')::timestamptz
          AT TIME ZONE 'Asia/Seoul')::date AS d
)
SELECT t.id, t.title AS 업무, COALESCE(ac.display_name, '—') AS 담당,
       t.due_date AS 기한, a.name AS 영역, t.status AS 상태,
       (t.due_date - (SELECT d FROM o)) AS 가오픈보다_며칠_뒤
  FROM task t
  LEFT JOIN actor ac ON ac.id = t.assignee_id
  JOIN area a ON a.id = t.area_id
 WHERE t.is_active AND t.status <> 'done'
   AND t.due_date > (SELECT d FROM o)
 ORDER BY t.due_date DESC, a.sort_order, t.id;

\echo ''
\echo '=== ③ 기한이 아예 없음 — 조정 대상 목록 (②보다 먼저 보십시오) ==='
SELECT t.id, t.title AS 업무, COALESCE(ac.display_name, '—') AS 담당,
       '—' AS 기한, a.name AS 영역, t.status AS 상태
  FROM task t
  LEFT JOIN actor ac ON ac.id = t.assignee_id
  JOIN area a ON a.id = t.area_id
 WHERE t.is_active AND t.status <> 'done' AND t.due_date IS NULL
 ORDER BY a.sort_order, t.id;
