-- 파트 0 — 영역 재편. workspace 5(R&D·플랫폼·디자인·연구소·현장실습교육) +
-- 교육자료(link_only, Notion 링크만) + 기타(비활성, 이력 보존).
-- kind/notion_url 추가는 비파괴. 아래 UPDATE는 영역 분류 정정(데이터 삭제 아님).

ALTER TABLE area ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE area DROP CONSTRAINT IF EXISTS area_kind_check;
ALTER TABLE area ADD CONSTRAINT area_kind_check CHECK (kind IN ('workspace', 'link_only'));
ALTER TABLE area ADD COLUMN IF NOT EXISTS notion_url TEXT;

-- 교육자료 → link_only (업무·목표 선택지 제외, 사이드바에서 Notion 링크로 표기)
UPDATE area SET kind = 'link_only' WHERE name = '교육자료';
-- 기타 → 비활성 (하드삭제 아님)
UPDATE area SET is_active = false WHERE name = '기타';

-- link_only·비활성 영역에는 업무/프로젝트/목표를 두지 않는다 → 워크스페이스로 재배치.
-- 교육자료 소속은 연구소로, 기타 소속은 플랫폼으로.
UPDATE task    SET area_id = (SELECT id FROM area WHERE name = '연구소') WHERE area_id = (SELECT id FROM area WHERE name = '교육자료');
UPDATE task    SET area_id = (SELECT id FROM area WHERE name = '플랫폼') WHERE area_id = (SELECT id FROM area WHERE name = '기타');
UPDATE project SET area_id = (SELECT id FROM area WHERE name = '연구소') WHERE area_id = (SELECT id FROM area WHERE name = '교육자료');
UPDATE project SET area_id = (SELECT id FROM area WHERE name = '플랫폼') WHERE area_id = (SELECT id FROM area WHERE name = '기타');
UPDATE goal    SET area_id = (SELECT id FROM area WHERE name = '연구소') WHERE area_id = (SELECT id FROM area WHERE name = '교육자료');
UPDATE goal    SET area_id = (SELECT id FROM area WHERE name = '플랫폼') WHERE area_id = (SELECT id FROM area WHERE name = '기타');

-- actor_area 재시드 (3인) — 이름 기준. 기존 3인 매핑 정리 후 지정 매핑 삽입.
DELETE FROM actor_area WHERE actor_id IN (
  SELECT id FROM actor WHERE type = 'human' AND display_name IN ('권정혁', '박주희', '조서연')
);
INSERT INTO actor_area (actor_id, area_id, sort_order)
SELECT a.id, ar.id, x.ord
FROM (VALUES
  ('권정혁', 'R&D', 0), ('권정혁', '플랫폼', 1),
  ('박주희', '플랫폼', 0), ('박주희', '연구소', 1),
  ('조서연', '디자인', 0), ('조서연', '플랫폼', 1)
) AS x(nm, area, ord)
JOIN actor a ON a.display_name = x.nm AND a.type = 'human'
JOIN area ar ON ar.name = x.area
ON CONFLICT (actor_id, area_id) DO NOTHING;
